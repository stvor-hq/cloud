# feat(plugin): agent-commerce — ERC-8183 agentic commerce with payload attestation and reputation gating

## What this plugin does

`@elizaos/plugin-agent-commerce` implements the [ERC-8183](https://eips.ethereum.org/EIPS/eip-8183) agentic commerce lifecycle for ElizaOS agents. It allows one agent (client) to commission work from another agent (provider), escrow funds, receive a deliverable, evaluate it, and settle — all within the ElizaOS runtime, with cryptographic payload attestation and policy enforcement at every step.

The full state machine:

```
OPEN → FUNDED → SUBMITTED → COMPLETE
                           ↘ REFUND
              ↘ EXPIRED
         ↘ ABORTED  (security abort at any stage)
```

---

## ElizaOS extension points

| Extension point | Name | Role |
|---|---|---|
| `Service` | `AgentCommerceService` | Owns `ElizaJobStore`, `ReputationProvider`, `SecurityGuard` per runtime |
| `Action` | `CREATE_SECURE_JOB` | Create an ERC-8183 job |
| `Action` | `FUND_SECURE_JOB` | Fund escrow and deliver SHA-256-attested task spec to provider |
| `Action` | `SUBMIT_DELIVERABLE` | Provider submits work with hash attestation |
| `Action` | `JOB_STATUS` | Query current job state |
| `Evaluator` | `SECURITY_GUARD` (`alwaysRun: true`) | Rate limiting + prompt-injection detection on every message |
| `Evaluator` | `COMMERCE_TRACKER` | Extracts job IDs from conversation and stores them in agent memory |
| `Provider` | `COMMERCE_CONTEXT` | Injects up to 5 most recent jobs into the LLM context window |

---

## State storage

Jobs are persisted via `ElizaJobStore`, which wraps `runtime.createMemory()`:

- **Write path**: on every state transition, the job is serialised (with `BigInt → string` for JSON safety) and written to the `memories` table under a `erc8183:job:<id>` prefix. `unique: false` is used so each transition creates a new record — no destructive updates.
- **Read path**: `get()` checks an in-memory `Map` first. On miss it calls `hydrate()`.
- **Scope**: memories are keyed to `agentId`, ensuring jobs from one runtime never appear in another.

---

## Recovery after restart

Hydration is lazy and race-safe:

```ts
private hydrate(): Promise<void> {
  if (!this.hydratePromise) {
    this.hydratePromise = this._doHydrate();
  }
  return this.hydratePromise;
}
```

All concurrent callers (evaluators, providers) await the same `Promise`. `_doHydrate()` fetches up to 1000 memories from the `memories` table, filters by prefix, deserialises each job, and keeps the record with the highest `updatedAt` (latest state wins). Hydration failure is non-fatal — the store starts empty and the agent continues operating.

---

## Tests

| File | Coverage |
|---|---|
| `tests/elizaos-plugin.test.ts` | Plugin shape, service registration, all 4 actions, provider output (11 cases) |
| `tests/elizaos-integration.test.ts` | `securityEvaluator` with live `SecurityGuard`, rate limit via service (3 cases) |
| `tests/agent-commerce-evaluator.test.ts` | `commerceEvaluator` handler, job ID extraction, `entityId` guard (5 cases) |
| `tests/commerce-flow.test.ts` | Full ERC-8183 lifecycle: create → fund → submit → evaluate → COMPLETE/REFUND/ABORT (14 cases) |
| `tests/reputation.test.ts` | `StaticReputationProvider`, `MemoryReputationProvider`, `CompositeReputationProvider` (7 cases) |

---

## Security considerations

### Payload hash verification
Every task specification sent to a provider is SHA-256 attested via `PayloadHasher.hashPayload()` (deterministic key-sorted serialisation). The hash is stored on the job (`metadata.taskPayloadHash`) and verified when the provider echoes the prompt back. Deliverable hashes are verified at submission and again when the transport bridge receives the `job_deliverable` message. Hash mismatch at any point triggers `abortJob`.

### Reputation gate
`fundJob` checks `IReputationProvider.canFundJob(agentId, amount)` before any state transition. Default provider (`StaticReputationProvider`) allows all agents (score 100). `MemoryReputationProvider` adjusts scores based on job outcomes. `CompositeReputationProvider` chains multiple providers with AND semantics.

### Rate limiting
`SecurityGuard` enforces 10 requests / 60 s per `entityId` in `securityEvaluator`. The guard instance is owned by `AgentCommerceService` — one per runtime, no shared state across agents.

### Timeout-based refunds
`CommerceTransportBridge` schedules a `responseWindowMs` (default 15 s) timeout after each peer handoff (prompt delivery, deliverable submission). If the peer does not respond, `refundJob` is called automatically. The timeout handle is cleared on any valid incoming message and on `destroy()`.

### State-machine validation
Every transition validates current state before mutating. `abortJob`, `refundJob`, and `expireJob` are idempotent (return early if already in terminal state). `evaluateJob` uses `timingSafeEqual` for decision comparison to prevent timing-based oracle attacks.

---

## Known limitations

- **Hydration ceiling**: `ElizaJobStore._doHydrate()` fetches at most 1000 memory records per agent. Agents with long-running histories exceeding 1000 job transitions may silently miss older records on restart. This limit is not configurable in this release.

- **Rate limiting is process-local**: `SecurityGuard.rateLimitStore` is an in-memory `Map`. Rate limit counters are not shared across processes or restarted agents. In a horizontally scaled deployment, each process enforces limits independently.

- **Deadline field is informational**: `onJobFunded` includes a `deadline` (now + 24 h) in the task payload sent to the provider. This value is **not enforced** by the state machine. The only enforced timeout is `responseWindowMs` (peer response window). The deadline is present for provider-side awareness only.

- **Memory table namespace**: jobs are stored in the shared `memories` table alongside conversation memories. The `erc8183:job:` prefix prevents collision, but hydration reads all agent memories up to the 1000-record limit and filters client-side.

- **`MemoryReputationProvider` is not persistent**: reputation scores earned during a session are lost on restart. For persistent reputation, wire in a custom `IReputationProvider` backed by a database or ElizaOS memories.
