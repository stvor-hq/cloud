# Security Model — plugin-agent-commerce

This document describes the security properties of `@stvor/plugin-agent-commerce`, what it
protects, what it does not protect, and the assumptions it makes.

---

## Protected assets

| Asset | How protected |
|---|---|
| Job payload content | SHA-256 attestation — hash stored on ledger, plaintext never written |
| Agent message integrity | Payload-injection heuristics in `SecurityGuard` (pattern matching on all inbound content) |
| Per-agent rate limiting | `InMemoryRateLimitStore` scoped to `AgentCommerceService` instance (max 10 req/60 s) |
| Job state machine | `ERC8183StateMachine` enforces legal transitions; illegal transitions throw |
| Funding gate | `IReputationProvider.canFundJob()` checked before any state change from OPEN → FUNDED |

## NOT protected by this plugin

- **Transport encryption** — this plugin is transport-agnostic. If you use `StvorTransportManager`, the sat-v1 protocol (Ed25519 + X25519 + HKDF-SHA256 + AES-256-GCM) is provided by the transport layer, not this plugin.
- **On-chain settlement** — job state transitions in this plugin are off-chain. On-chain payment verification is out of scope.
- **Persistent replay protection** — the in-memory rate limit store resets on process restart. Use a Redis-backed `IRateLimitStore` for production replay protection.
- **Distributed rate limiting** — `InMemoryRateLimitStore` is per-process. In a multi-replica deployment each replica has independent state.
- **Sybil resistance** — `StaticReputationProvider` (default) approves any agent. Replace with a real reputation source for production.
- **Audit logging** — the plugin logs events at INFO level via the ElizaOS logger. Structured audit logs must be wired separately.

---

## Trust boundaries

```
┌────────────────────────────────────────────────────────┐
│  IAgentRuntime (ElizaOS)                               │
│                                                        │
│  ┌──────────────────────┐                              │
│  │  AgentCommerceService│ ← per-runtime, scoped state  │
│  │  ├ SecurityGuard     │   (rate limits, injection)   │
│  │  ├ IJobStore         │   (ERC-8183 lifecycle)       │
│  │  └ IReputationProv.  │   (funding gate)             │
│  └──────────────────────┘                              │
│                                                        │
│  Actions / Evaluators / Provider                       │
│  (obtain service via runtime.getService())             │
└────────────────────────────────────────────────────────┘
        │
        │ ICommerceContext (runtime boundary)
        ▼
┌───────────────────────────┐
│  ERC8183StateMachine      │ ← pure; no I/O; fully testable
└───────────────────────────┘
```

**Trusted within this boundary:**
- `IAgentRuntime` — the runtime is trusted; settings returned by `runtime.getSetting()` are not validated further.
- `IJobStore` — the store is trusted within a single runtime instance.
- `ERC8183StateMachine` — pure state transitions; trusted.

**Untrusted across this boundary:**
- `message.content` from any agent — always passed through `SecurityGuard.assertPayloadSafe()`.
- `agentId` strings — validated for format only (`/^job-[\w-]+$/`); caller identity is not cryptographically verified at the plugin layer.

---

## Threat model

### IN SCOPE

| Threat | Control |
|---|---|
| Prompt injection via message text | Pattern matching across 40+ known injection signatures (instruction override, role confusion, delimiter injection, exfiltration, base64-encoded instructions) |
| Oversized payloads | Hard cap at 16 384 bytes; configurable via `SecurityGuardOptions.maxPayloadBytes` |
| Invisible Unicode characters | U+200B, U+200C, U+200D, U+FEFF detected and blocked |
| Control character injection | C0/C1 control chars (except TAB, LF, CR) blocked in all string values |
| Rapid-fire flooding | Rate limit: 10 requests per 60 s per agent ID |
| Illegal job state transitions | `ERC8183StateMachine` throws on any invalid state change |
| Reputation bypass | `IReputationProvider.canFundJob()` is checked before FUNDED transition |

### OUT OF SCOPE

| Threat | Reason |
|---|---|
| Message origin spoofing | Caller identity is an opaque string; plugin trusts the runtime to authenticate senders |
| Replay attacks across restarts | In-memory rate limit store resets on restart |
| Multi-replica rate limit bypass | One store per process; no cross-replica coordination |
| Compromised ElizaOS runtime | Plugin cannot protect against a malicious runtime |
| On-chain payment fraud | Settlement is off-chain in this plugin |

---

## Assumptions

1. **One `AgentCommerceService` instance per `IAgentRuntime`.** The ElizaOS runtime starts exactly one service instance per registered service type. The plugin relies on this guarantee for isolation between concurrent agent runtimes.

2. **`runtime.getSetting()` returns operator-controlled values.** Settings are not user-controllable at runtime. If `STVOR_STRICT_MODE` or `COMMERCE_MIN_REPUTATION` can be set by untrusted users, tighten access control at the runtime layer.

3. **`IJobStore` implementation is single-process.** The default `ElizaJobStore` uses an in-memory cache with best-effort ElizaOS memory persistence. It is not safe for multi-replica deployments without a shared backend (e.g. Redis).

4. **Pattern matching is heuristic, not exhaustive.** `SecurityGuard` detects known injection patterns but cannot prevent novel attacks. It is a defense-in-depth measure, not a security boundary.

---

## Known limitations

- **No `recordOutcome` integration.** `IReputationProvider.recordOutcome()` is defined on `MemoryReputationProvider` and `CompositeReputationProvider` but is not automatically called when a job is evaluated. Callers must invoke it manually or wire it through a lifecycle event hook.

- **`ElizaJobStore` hydration is lazy.** Jobs persisted in ElizaOS memories are loaded on first `get()` or `listByAgent()` call. A process restart will temporarily show an empty store until hydration completes.

- **Static `SecurityGuard` methods are deprecated.** `SecurityGuard.checkRateLimit()`, `.assertPayloadSafe()`, `.evaluatePolicy()`, and `.assertJobIdFormat()` use a module-level shared store. They remain for backward compatibility but share state across all agents in the same process. Use `AgentCommerceService.securityGuard` (per-runtime instance) instead.

- **`StubReputationGate` is for development only.** It is used in demo flows and unit tests. Do not use it in production — it does not enforce real reputation checks.
