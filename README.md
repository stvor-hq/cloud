# Stvor AI Security

Quantum-resistant encrypted escrow for autonomous agents. Prevents credential theft from quantum cryptanalysis and prompt injection attacks.

## Install

```json
{
  "dependencies": {
    "@elizaos/plugin-agent-commerce": "github:stvor-hq/ai-security"
  }
}
```

```json
{
  "name": "SecureCommerceAgent",
  "plugins": ["@elizaos/plugin-agent-commerce"],
  "settings": {
    "STVOR_RELAY_URL": "wss://cloud-production-75c5.up.railway.app",
    "STVOR_APP_TOKEN": "your-railway-token",
    "STVOR_STRICT_MODE": "true"
  }
}
```

## What the plugin does

| Action | Description |
|--------|-------------|
| CREATE_SECURE_JOB | Create ERC-8183 job with PQC-secured transport |
| FUND_SECURE_JOB | Fund job and trigger encrypted task delivery |
| SUBMIT_DELIVERABLE | Submit encrypted deliverable for funded job |
| JOB_STATUS | Check status of commerce job |

2 evaluators (SECURITY_GUARD, COMMERCE_TRACKER) and 1 provider (COMMERCE_CONTEXT) are registered automatically.

## Cryptography

| Layer | Algorithm |
|-------|-----------|
| Key exchange | P-256 X3DH + ML-KEM-768 |
| Sessions | Double Ratchet |
| Symmetric | AES-256-GCM |
| Ledger | SHA-256 attestation only |

Hybrid design: quantum-resistant KEM + classical key exchange + forward-secret sessions + AEAD payloads.

An attacker capturing ciphertext today cannot recover plaintext even with a future quantum computer.

## Implementation status

| Component | Status | Notes |
|-----------|--------|-------|
| ML-KEM-768 + Double Ratchet | ✅ | @stvor/web3 Rust/WASM, 53 NIST vectors |
| Key storage | ✅ | AES-256-GCM, scrypt KDF |
| SecurityGuard | ✅ | 4 attack categories, rate limiting, replay protection |
| Audit log | ✅ | SHA-256 hash-chain, tamper-detectable |
| ERC-8183 state machine | ✅ | 6 states: OPEN→FUNDED→SUBMITTED→COMPLETE/REFUND/ABORTED |
| ElizaOS plugin | ✅ | PR-ready npm package |
| Production relay | ✅ | wss://cloud-production-75c5.up.railway.app |
| On-chain contract | ⚠️ | AgenticCommerce.sol compiled, deployment pending |
| x402 blockchain signing | 🔜 | Protocol layer done, EIP-712 pending |

## Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| STVOR_RELAY_URL | WebSocket relay endpoint | undefined |
| STVOR_APP_TOKEN | Relay authentication token | undefined |
| STVOR_STRICT_MODE | Enforce PQC encryption | false |
| STVOR_ALLOW_MOCK | Allow mock relay fallback | false |
| STVOR_KEY_PASSWORD | Key encryption password | generated |

## Self-hosted relay

```bash
bun start:relay
curl http://localhost:4444/health
```

Deploy to Railway free tier — railway.json included.

## Development

```bash
bun install
bun test        # 89 tests
bun run type-check
bun start:demo
```

## Tests

89 tests across 13 files, 0 failures, 431 encryptions/sec.

## License

Apache 2.0