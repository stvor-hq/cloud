/**
 * @file ARCHITECTURE.md — Transport Layer Deep Dive
 * 
 * Detailed technical documentation for the Stvor SDK integration
 * and how it relates to the ERC-8183 commerce protocol.
 */

# Stvor Transport Layer Architecture

## Overview

The Stvor transport layer provides **production-grade, quantum-resistant end-to-end encryption** for all agent-to-agent communication in the commerce protocol.

### Key Technologies

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Key Exchange** | Signal Protocol X3DH | Initial key negotiation with identity verification |
| **Forward Secrecy** | Double Ratchet | Per-message key rotation (ratcheting) |
| **Post-Quantum** | ML-KEM-768 (Kyber) | Hybrid classical + quantum-resistant encryption |
| **Symmetric** | AES-256-GCM | Authenticated encryption of payloads |
| **Hashing** | SHA-256 | Ledger attestation (no plaintext exposure) |

## Data Flow: Job Lifecycle with Encryption

### Stage 1: Job Creation (OPEN)

**Alice (Client) creates a job**
```
createJob(
  clientAgent: "alice",
  providerAgent: "bob",
  taskDescription: "Build ML pipeline",
  requiredAmount: 1_000_000
)
```

**Result:**
- Job recorded in mock ledger with ID (e.g., `job-abc123`)
- State: `OPEN`
- No encrypted payloads yet

### Stage 2: Job Funding (OPEN → FUNDED)

**Alice funds the job**
```
fundJob(
  jobId: "job-abc123",
  clientAgent: "alice",
  fundAmount: 1_000_000
)
```

**Process:**

1. **Reputation Gate Check** (mock, can verify on-chain)
   ```typescript
   const canFund = await reputationGate.canFundJob("alice", 1_000_000)
   // Returns: boolean based on agent's on-chain/mock reputation
   ```

2. **State Transition**
   - Job moves to `FUNDED` state
   - Escrow locked in mock ledger

3. **Secure Payload Preparation** (via CommerceTransportBridge)
   ```typescript
   const taskPayload = {
     jobId: "job-abc123",
     taskDescription: "Build ML pipeline",
     deadline: Date.now() + 24h,
     metadata: { ... }
   }
   
   const payloadHash = SHA-256(JSON.stringify(taskPayload))
   // payloadHash stored on mock ledger for attestation
   ```

4. **Secure Delivery via Stvor**
   ```typescript
   const msgId = await transport.sendSecurePayload(
     recipientId: "bob",
     jobId: "job-abc123",
     messageType: "job_prompt",
     payload: taskPayload
   )
   ```

   **Under the hood (Stvor SDK):**
   - Stvor retrieves Bob's long-term public key from relay
   - Performs X3DH handshake → establishes shared secret
   - Derives Double Ratchet state
   - Encrypts payload with AES-256-GCM
   - Sends ciphertext to relay

5. **Result:**
   - Alice's `transport.sendSecurePayload()` returns message ID
   - Relay queues encrypted payload for Bob
   - SHA-256 hash recorded on ledger (proof without plaintext)

### Stage 3: Provider Receives Encrypted Prompt

**Bob's transport layer receives the message**
```typescript
transport.onMessage(async (msg) => {
  // msg is already decrypted by Stvor SDK
  console.log(msg.content.data) // Full plaintext of taskPayload
})
```

**Process:**

1. **Relay delivers ciphertext to Bob**
   - Relay doesn't have keys, can't decrypt

2. **Stvor SDK decrypts**
   ```typescript
   // Inside Stvor SDK:
   // 1. Retrieve Alice's long-term public key
   // 2. Use Bob's private key + Double Ratchet state
   // 3. Decrypt AES-256-GCM ciphertext
   // 4. Verify authentication tag
   // 5. Ratchet forward (update state for next message)
   ```

3. **Application receives plaintext**
   ```typescript
   // Bob's handler
   msg.content.data === {
     jobId: "job-abc123",
     taskDescription: "Build ML pipeline",
     deadline: <timestamp>,
     ...
   }
   ```

### Stage 4: Provider Submits Deliverable (FUNDED → SUBMITTED)

**Bob completes work and submits**
```
submitJob(
  jobId: "job-abc123",
  providerAgent: "bob",
  deliverableHash: SHA-256(encryptedDeliverable)
)
```

**Process:**

1. **Bob executes work locally**
   - Produces deliverable (code, data, result)

2. **Encrypt for Evaluator (Charlie)**
   ```typescript
   const deliverable = {
     jobId: "job-abc123",
     completionTime: "2h 15m",
     output: {...},
     quality: {...}
   }
   
   const deliverableHash = SHA-256(JSON.stringify(deliverable))
   
   await transport.sendSecurePayload(
     recipientId: "charlie",
     jobId: "job-abc123",
     messageType: "job_deliverable",
     payload: deliverable
   )
   ```

3. **Stvor encrypts for Charlie**
   - X3DH with Charlie's key (if first message)
   - Or use existing Double Ratchet state
   - AES-256-GCM encryption
   - Send to relay

4. **Record on ledger**
   ```typescript
   submitJob() {
     // Record deliverableHash on ledger
     job.deliverableHash = deliverableHash
     job.state = "SUBMITTED"
   }
   ```

### Stage 5: Evaluator Settles (SUBMITTED → COMPLETE/REFUND)

**Charlie receives encrypted deliverable**
```typescript
transport.onMessage(async (msg) => {
  if (msg.content.type === "job_deliverable") {
    const deliverable = msg.content.data
    // Fully decrypted via Stvor
  }
})
```

**Process:**

1. **Charlie evaluates deliverable**
   ```typescript
   const decision = evaluateQuality(deliverable)
   // Returns: "ACCEPT" | "REJECT" | "PARTIAL"
   ```

2. **Record evaluation**
   ```typescript
   await commerce.evaluateJob(
     jobId: "job-abc123",
     decision: "ACCEPT",
     reason: "Meets all specifications"
   )
   ```

3. **State transition**
   - Job moves to `COMPLETE` (if ACCEPT) or `REFUND` (if REJECT)
   - Settlement recorded on mock ledger

## Payload Hashing & Ledger Attestation

### Why Hash Payloads?

The mock ledger records **only hashes**, not plaintext:
- No exposure of sensitive task specs or proprietary algorithms
- Cryptographic proof of payload existence
- Enables non-repudiation (agent can't deny sending payload)

### SHA-256 Hash Generation

```typescript
const hasher = new PayloadHasher()

const hash = hasher.hashPayload({
  jobId: "job-123",
  data: "sensitive work"
})
// hash = "a1b2c3d4..." (64-char hex string)

// Verify integrity later
const isValid = hasher.verifyHash(payload, hash)
// isValid = true if SHA-256(payload) === hash
```

### Ledger Storage

```typescript
// Mock ledger stores:
jobs[jobId] = {
  state: "FUNDED",
  taskPayloadHash: "a1b2c3d4...", // ← Proof, not plaintext
  deliverableHash: null,           // ← Filled on SUBMITTED
  evaluationStatus: null,          // ← Filled on COMPLETE/REFUND
}
```

## Double Ratchet Key Management

The Stvor SDK automatically manages Double Ratchet state for each session:

```typescript
// Session between Alice and Bob

// Message 1 (Alice → Bob): "Here's your task"
// - Stvor derives key[0] from X3DH shared secret
// - Encrypt with key[0]
// - Ratchet: key[0] → key[1]

// Message 2 (Bob → Alice): "Task received"
// - Bob receives message 1, derives key[0]
// - Decrypt and verify
// - Ratchet: key[0] → key[1]
// - Bob responds with key[1]

// Message 3 (Alice → Bob): Follow-up
// - Alice uses key[1] (she already ratcheted)
// - Both agents stay synchronized

// Forward Secrecy Guarantee:
// If key[5] is compromised, keys 1-4 cannot be recovered
// ∴ Past messages remain secure
```

## Transport API Surface

### Client API: `StvorTransportManager`

```typescript
// Initialize
const transport = new StvorTransportManager({
  agentId: "alice",
  appToken: "stvor_dev_test123",
  relayUrl: "http://localhost:4444"
})

// Connect to relay
await transport.connect()

// Send encrypted payload
const msgId = await transport.sendSecurePayload(
  recipientId: "bob",
  jobId: "job-123",
  messageType: "job_prompt",
  payload: { task: "..." }
)

// Receive encrypted payload (auto-decrypted)
const msg = await transport.receiveSecureMessage(5000) // 5s timeout
if (msg) {
  console.log(msg.content.data) // Plaintext
}

// Or use event-driven API
transport.onMessage(async (msg) => {
  console.log("Received:", msg.content.type)
})

// Query session status
const session = await transport.getSessionStatus("bob")

// Get stats
const status = await transport.getStatus()

// Cleanup
await transport.disconnect()
```

### Internal: Message Structure

**Encrypted on wire:**
```json
{
  "id": "msg-1234567890",
  "from": "alice",
  "to": "bob",
  "timestamp": 1718700000000,
  "ciphertext": "base64-encoded AES-GCM ciphertext",
  "iv": "base64-encoded IV/nonce",
  "ephemeralPublicKey": "base64-encoded X3DH ephemeral key",
  "messageType": "job_prompt|job_deliverable|job_evaluation"
}
```

**Decrypted by recipient:**
```json
{
  "id": "msg-1234567890",
  "from": "alice",
  "to": "bob",
  "timestamp": 1718700000000,
  "content": {
    "type": "job_prompt",
    "jobId": "job-123",
    "data": {
      "taskDescription": "...",
      "deadline": 1718786400000,
      ...
    }
  },
  "metadata": {
    "payloadHash": "a1b2c3d4..."
  }
}
```

## Integration with Commerce Plugin

### CommerceTransportBridge

Listens to job state transitions and triggers transport events:

```typescript
class CommerceTransportBridge implements ICommerceEventListener {
  async onJobFunded(job: IErc8183Job) {
    // 1. Prepare encrypted task specification
    // 2. Send via transport.sendSecurePayload()
    // 3. Store hash on ledger
  }

  async onJobSubmitted(job: IErc8183Job) {
    // 1. Verify deliverable hash on ledger
    // 2. Prepare encrypted result
    // 3. Route to evaluator
  }

  async onJobEvaluated(job: IErc8183Job, decision: string) {
    // 1. Record evaluation result
    // 2. Log audit trail
  }
}
```

### Runtime Integration

```typescript
// In src/index.ts
const transport = new StvorTransportManager({...})
await transport.connect()

const commerce = createCommercePlugin(runtime, transport)
const bridge = createCommerceTransportBridge(transport)
commerce.registerEventListener(bridge)

// Now:
// - commerce.fundJob() automatically sends encrypted task
// - commerce.submitJob() automatically sends encrypted deliverable
// - commerce.evaluateJob() automatically settles
```

## Security Properties

### Confidentiality
- **AES-256-GCM**: 256-bit authenticated encryption
- **Post-Quantum**: ML-KEM-768 provides quantum resistance
- **Hybrid**: Classical X25519 + quantum ML-KEM combined
- **Result**: Resistant to both classical and quantum computers

### Integrity
- **Authentication Tag**: GCM AEAD (Authenticated Encryption with Associated Data)
- **Signature Verification**: Built-in Stvor SDK
- **Result**: Detect tampering immediately

### Forward Secrecy
- **Double Ratchet**: Each message rotates keys
- **DFS Property**: Compromise of current key doesn't leak past messages
- **Result**: Past communications remain secure even if long-term key is stolen

### Authentication
- **Long-term Keys**: Alice's and Bob's identity verified by relay
- **X3DH**: Mutual authentication built-in
- **Result**: No impersonation possible

## Performance Characteristics

| Operation | Time | Notes |
|-----------|------|-------|
| Key exchange (X3DH) | ~10ms | One-time per session |
| Message encryption (AES-GCM) | ~1-2ms | Per message |
| Double ratchet update | <1ms | Per message |
| Relay latency | ~50-200ms | Network dependent |
| Full job cycle | <30s | Create → Fund → Submit → Evaluate |

## Monitoring & Debugging

### Transport Status
```bash
curl http://localhost:8080/api/transport/status
# Returns: connected, agentId, activeSessions, messagesReceived, messagesSent
```

### Session Status
```bash
curl http://localhost:8080/api/transport/session/bob
# Returns: session ID, key iteration count, expiry time
```

### CLI Commands
```bash
bun start:cli
[alice]$ transport-status
[alice]$ transport-session bob
```

## Production Deployment (Waifu.fun / elizaOS Cloud)

### Key Management
Keys are persisted encrypted at `STVOR_KEY_DIR/agent-keypair.enc` using:
- **KDF**: scrypt (N=2^17, r=8, p=1) — OWASP recommended
- **Encryption**: AES-256-GCM
- **Password**: `STVOR_KEY_PASSWORD` environment variable

**Important Security Change**: If `STVOR_KEY_PASSWORD` is not set:
1. A cryptographically strong random password (32 bytes) is generated using `crypto.randomBytes(32).toString('hex')`.
2. The password is stored in `.stvor_key_pass` in the project root with mode `0600`.
3. On subsequent starts, the password is read from this file.

For production deployments, always set `STVOR_KEY_PASSWORD` explicitly. Never commit `.stvor_key_pass` to version control.

### Relay Configuration
The relay fallback now requires explicit opt-in for security:
- Set `STVOR_RELAY_URL=wss://relay.stvor.xyz` for production relay
- If not configured or set to `'mock'`, the mock relay is only available when `STVOR_ALLOW_MOCK='true'`
- In production (`NODE_ENV !== 'development'`), missing `STVOR_RELAY_URL` throws an error unless `STVOR_ALLOW_MOCK='true'`

### ElizaOS Security Evaluator
The plugin includes a `SECURITY_GUARD` evaluator that:
- Hooks into every incoming message
- Checks if `msg.encrypted === true` (messages received through Stvor transport have this flag)
- In strict mode (`STVOR_STRICT_MODE='true'`): rejects unencrypted messages with an error
- In non-strict mode (default): logs a warning for unencrypted messages but allows them to proceed

Configure via environment or character settings:
```
STVOR_STRICT_MODE=true   # Reject unencrypted messages
STVOR_STRICT_MODE=false  # Warn only (default)
```

### Phase 3: Production Relay
Replace `MockRelayClient` by setting:
```
STVOR_RELAY_URL=wss://relay.stvor.xyz
STVOR_APP_TOKEN=<your-token>
```

**Phase 3 Interfaces (written, ready for implementation):**

#### P3.1 — WebSocket Relay (`src/transport/relay.ts`)
- Interface: `IRelay` with `connect`, `disconnect`, `send`, `onMessage`, `isConnected`, `getStats`
- Implementation: `WebSocketRelay` (connects to `wss://relay.stvor.xyz`)
- Factory: `createRelay()` returns `WebSocketRelay` if `STVOR_RELAY_URL` starts with `wss://`, else falls back to `MockRelayClient` **only if** `STVOR_ALLOW_MOCK='true'`

#### P3.2 — Reputation Gate (`src/plugins/agent-commerce/reputation.ts`)
- Interface: `IReputationGate` with `canFundJob`, `getScore`, `recordOutcome`
- Implementation: `MockReputationGate` (in-memory scores)
- Phase 3 replacements: `ERC8004ReputationGate`, `SolanaOracleReputationGate`

#### P3.3 — On-Chain Escrow (`contracts/AgenticCommerce.sol`)
- ERC-8183 reference implementation deployed to Sepolia
- Address: see `src/contracts/addresses.json`
- Integration: `src/contracts/on-chain.ts` (load addresses, compute attestation hashes)

### Performance Characteristics (benchmarked)
| Operation | Avg latency | Throughput |
|-----------|-------------|------------|
| Key generation (ML-KEM-768 + X25519) | <50ms | — |
| Encrypt (hybrid) | <10ms | >20 ops/sec |
| Decrypt (hybrid) | <10ms | >20 ops/sec |
| SHA-256 hash | <1ms | >1000 ops/sec |

### Bun vs Node.js
The project uses Bun ≥1.0.0. If elizaOS Cloud runs Node.js ≥20, replace:
- `Bun.file()` → `fs.readFileSync()`
- `bun:test` → `jest` or `vitest` (test files only)
- All crypto uses Node.js built-ins (`crypto` module) — no changes needed

## Enterprise Production Mode

The project includes a production-hardening layer activated via `STVOR_PRODUCTION_MODE=true`. When enabled, the following rules are enforced:

### Transport Layer (`src/transport/pqc.ts`)
- `STVOR_RELAY_URL` must be set and must start with `wss://`.
- Mock relay fallback is disabled entirely; `STVOR_ALLOW_MOCK` is ignored.
- Cryptographic errors are logged with a unique event ID, agent ID, and ISO timestamp, and re-thrown as `PqcEncryptionError` for upstream handling.

### API Server (`src/api/server.ts`)
- `STVOR_API_KEY` is required. The default `stvor-demo-key` is rejected in production.
- Challenge storage is persisted to disk (`STVOR_CHALLENGE_STORE`, default `./data/challenges.json`) via `IChallengeStore`. For clusters, swap the implementation with Redis.

### KeyStore (`src/transport/key-store.ts`)
- `STVOR_KEY_PASSWORD` is required. Automatic generation of `.stvor_key_pass` is disabled.
- Key loading/generation throws if the password is missing.

### Rate Limiting (`src/core/security.ts`)
- Rate-limit state is persisted via `IRateLimitStore` (default file-based `STVOR_RATE_LIMIT_STORE`).
- In-memory `Map` is still used in development for speed.

### Relay Server (`src/relay-server.ts`)
- `RELAY_TOKEN` is required when `NODE_ENV=production`.

### Recommendations for Multi-Instance Deployments
- Replace file-based `IChallengeStore` and `IRateLimitStore` with Redis or a database-backed implementation.
- Use an HSM or managed KMS for `STVOR_KEY_PASSWORD` and relay tokens.
- Run the relay server behind a TLS-terminating load balancer.

## Future Enhancements

- [ ] Persistent key storage (HSM or encrypted file)
- [ ] Session resumption (after reconnect)
- [ ] Out-of-order message handling
- [ ] Rate limiting & DDoS protection
- [ ] Metrics collection (latency, throughput)
- [ ] Integration with Solana on-chain reputation
- [ ] Multi-relay failover

---

**Phase 2**: Real hybrid PQC transport implemented using `@stvor/web3` (Rust/WASM)
(ML-KEM-768 + P-256 X3DH + Double Ratchet). The relay layer uses an in-process mock; production relay
deployment is Phase 3.
