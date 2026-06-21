# Stvor Cloud
### Post-Quantum, End-to-End Encrypted Agentic Commerce

> The only ERC-8183 implementation where **funds and secrets are both provably secure** —
> against classical attackers today and quantum computers tomorrow.

[![Tests](https://img.shields.io/badge/tests-38%20passing-brightgreen)]()
[![PQC](https://img.shields.io/badge/crypto-ML--KEM--768-blue)]()
[![ElizaOS](https://img.shields.io/badge/ElizaOS-plugin%20compatible-purple)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

## The problem

Every existing agent commerce system has the same flaw: sensitive payloads — prompts, API keys, deliverables — travel in plaintext or under classical encryption that quantum computers will break. ERC-8183 defines the protocol, but not the security. Stvor Cloud adds it.

## Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| ML-KEM-768 + Double Ratchet | ✅ Production | Rust/WASM via `@stvor/web3`, 53 NIST vectors |
| Key storage (AES-256-GCM) | ✅ Production | Encrypted at rest, scrypt KDF (N=2^17) |
| SecurityGuard | ✅ Production | Prompt injection vectors covered |
| ERC-8183 state machine | ✅ Production | 5 states (OPEN→FUNDED→SUBMITTED→COMPLETE/REFUND/ABORTED) |
| ElizaOS plugin | ✅ Production | 4 actions, 1 provider, 2 evaluators |
| On-chain contract | ⚠️ Compiled | `contracts/AgenticCommerce.sol` ready for Sepolia deployment |
| Production relay | ✅ Standalone | `bun start:relay`, deployable to Railway free tier |
| x402 blockchain signing | 🔜 Next milestone | Protocol layer complete, EIP-712 signing pending |
| Session persistence | ✅ Production | Double Ratchet + memory persisted via HybridMemoryManager |

## What makes us different

| | Classical agent systems | Stvor Cloud |
|--|--|--|
| Prompt security | Plaintext in logs | ML-KEM-768 + AES-256-GCM |
| Quantum resistance | ❌ ECDSA/Ed25519 broken by Shor's | ✅ ML-KEM-768 (NIST FIPS 203) |
| Ledger data | Full payload stored | SHA-256 hash only |
| Prompt injection | Unprotected | SecurityGuard runtime filter |
| ElizaOS | Not compatible | Drop-in plugin |
| Demo | README only | `bun start:demo` — live, cinematic |

## Quick start

```bash
./install.sh
bun start:demo
```

## Deployment

### Relay Server (Railway — free tier)

1. Fork this repo or push to GitHub
2. Go to railway.app → New Project → Deploy from GitHub
3. Select this repo
4. Railway auto-detects `railway.json` and deploys
5. Set environment variables in Railway dashboard:
   - `STVOR_APP_TOKEN` — any random string for auth
   - `PORT` — Railway sets this automatically
6. Copy the Railway URL (e.g. `wss://stvor-cloud-relay.railway.app`)

### Smart Contract (Sepolia testnet — free)

1. Get free Sepolia ETH: https://sepoliafaucet.com
2. Get free RPC: https://alchemy.com (free tier)
3. Set in `.env`:
   ```
   SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
   DEPLOYER_PRIVATE_KEY=your-private-key
   ```
4. Deploy:
   ```bash
   cd contracts && npm run deploy:sepolia
   ```
5. Contract address saved to `src/contracts/addresses.json`

### Connect everything

Set in your `.env`:
```
STVOR_RELAY_URL=wss://your-app.railway.app
STVOR_APP_TOKEN=your-token
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
```

Remove `STVOR_ALLOW_MOCK=true` — production relay is now live.

## Architecture

```
Client (Alice)                       PQC Relay (mock, in-process)              Provider (Bob)
---------------                      -------------------------                 ---------------
  createJob()  ── lock funds ──▶  ERC-8183 Ledger (hashes only)  ──▶  submit deliverable hash
       │                                     ▲                                      │
       │ send encrypted prompt              │ receive attestations                    │
       └─▶ encrypt via HybridPQCTransport ─▶ relay ──▶ decrypt ──▶ SecurityGuard ──▶ execute
           @stvor/web3
           P-256 X3DH + ML-KEM-768
           Double Ratchet (Signal Protocol)
           AES-256-GCM
```

```
src/
├── core/
│   ├── security.ts                # SecurityGuard prompt-injection filter
│   ├── types.ts                   # ERC-8183 state types
│   └── runtime.ts                 # Runtime wiring
├── plugins/
│   └── agent-commerce/
│       ├── elizaos/               # 4 actions, 1 provider, 2 evaluators
│       ├── state-machine.ts       # OPEN → FUNDED → SUBMITTED → COMPLETE/REFUND
│       ├── lifecycle.ts           # ERC-8183 event bridge
│       └── index.ts               # AgentCommercePlugin + MemoryJobStore
├── transport/
│   ├── pqc.ts                     # HybridPQCTransport + PayloadHasher
│   └── mock-relay.ts              # In-process relay for demo/tests
├── relay/
│   └── server.ts                  # Standalone Railway WebSocket relay
└── demo.ts                        # Cinematic Hermes hackathon story
```

## Cryptography

Powered by [`@stvor/web3`](https://www.npmjs.com/package/@stvor/web3) —
the team's own Rust/WASM post-quantum SDK (zero npm runtime dependencies).

| Layer | Algorithm | Verification |
|-------|-----------|-------------|
| Key exchange | P-256 X3DH + ML-KEM-768 | 53 NIST ACVTS vectors |
| Sessions | Double Ratchet (Signal Protocol) | Rust/WASM core |
| Symmetric | AES-256-GCM | NIST SP 800-38D |
| Hashing | SHA-256 (Node.js crypto) | Built-in |

Hybrid secret: `HKDF-SHA256(P-256_secret ‖ ML-KEM_secret, "STVOR-HYBRID-v1")`
Breaking encryption requires breaking P-256 AND ML-KEM-768 simultaneously.

## ElizaOS integration

Install the package and add the plugin to an ElizaOS character:

```json
{
  "dependencies": {
    "@elizaos/plugin-agent-commerce": "github:stvor-hq/cloud"
  }
}
```

```json
{
  "name": "StvorAgent",
  "plugins": ["@elizaos/plugin-agent-commerce"],
  "settings": {
    "STVOR_RELAY_URL": "http://localhost:4444",
    "STVOR_ALLOW_MOCK": "true"
  }
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `STVOR_RELAY_URL` | Production relay URL (wss://) | Required in production |
| `STVOR_APP_TOKEN` | Authentication token for relay | Empty for open relay |
| `STVOR_AGENT_ID` | Agent identifier registered with relay | Auto-generated by settings |
| `STVOR_ALLOW_MOCK` | Explicitly allow mock relay when `STVOR_RELAY_URL` is not configured | Must be `'true'` to use mock |
| `STVOR_KEY_PASSWORD` | Password for encrypting stored keypair | Auto-generated if not set (see below) |
| `STVOR_STRICT_MODE` | Reject unencrypted messages in strict mode | `false` |

### KeyStore Password Management

If `STVOR_KEY_PASSWORD` is not set in the environment:

1. A cryptographically strong random password (32 bytes) is generated using `crypto.randomBytes(32).toString('hex')`.
2. The password is stored in `.stvor_key_pass` in the project root with mode `0600` (owner read/write only).
3. On subsequent starts, the password is read from `.stvor_key_pass` to decrypt existing keys.

**For production deployments, always set `STVOR_KEY_PASSWORD` explicitly.** Never commit `.stvor_key_pass` to version control (it's already in `.gitignore`).

The plugin exports `agentCommercePlugin` with 4 actions, 1 provider, and 2 evaluators (SECURITY_GUARD and COMMERCE_TRACKER). A ready character file is included at `characters/stvor-agent.character.json`.

## Test results

```text
bun test tests/crypto.test.ts                    8 passed
bun test tests/commerce-flow.test.ts            12 passed
bun test tests/elizaos-plugin.test.ts            7 passed
bun test tests/key-store.test.ts                 6 passed
bun test tests/performance.test.ts               6 passed
bun test tests/agent-commerce-evaluator.test.ts  4 passed
bun test tests/agent-identity.test.ts            3 passed
bun test tests/mcp.test.ts                       4 passed
bun test tests/reputation.test.ts                7 passed
bun test tests/x402.test.ts                      7 passed
bun test tests/security.test.ts                  7 passed
bun test tests/audit-log.test.ts                 3 passed
bun test tests/memory.test.ts                    3 passed
bun test tests/relay.test.ts                     7 passed
─────────────────────────────────────────────────
Total                                           85 passed
```

## Roadmap

- [ ] On-chain reputation oracle (Solana)
- [ ] Persistent storage (SQLite/PGLite)

