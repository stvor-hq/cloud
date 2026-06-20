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
│       ├── elizaos/               # 4 actions, 1 provider, 1 evaluator
│       ├── state-machine.ts       # OPEN → FUNDED → SUBMITTED → COMPLETE/REFUND
│       ├── lifecycle.ts           # ERC-8183 event bridge
│       └── index.ts               # AgentCommercePlugin + MemoryJobStore
├── transport/
│   ├── pqc.ts                     # HybridPQCTransport + PayloadHasher
│   └── mock-relay.ts              # In-process relay for demo/tests
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
    "STVOR_RELAY_URL": "http://localhost:4444"
  }
}
```

The plugin exports `agentCommercePlugin` with 4 actions, 1 provider, and 1 evaluator. A ready character file is included at `characters/stvor-agent.character.json`.

## Test results

```text
bun test tests/crypto.test.ts          8 passed
bun test tests/commerce-flow.test.ts  12 passed
bun test tests/elizaos-plugin.test.ts  6 passed
bun test tests/key-store.test.ts       4 passed
bun test tests/performance.test.ts     6 passed
─────────────────────────────────────────────────
Total                                 36 passed
```

## Roadmap

- [ ] Production Stvor relay (replace mock)
- [ ] On-chain reputation oracle (Solana)
- [ ] Persistent storage (SQLite/PGLite)

## Built for

Hermes AI Agent Hackathon — ERC-8183 track
