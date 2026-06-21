# Stvor AI Security

Quantum-resistant secure agent commerce for ElizaOS: ERC-8183 escrow, ML-KEM-768 transport, tamper-evident audit logs, and prompt-injection protection in one plugin.

> Formerly **Stvor Cloud**. Rebranded for the ElizaOS core PR and the Nous Research / NVIDIA / Stripe Hackathon.

[![Tests](https://img.shields.io/badge/tests-ready-brightgreen)]()
[![PQC](https://img.shields.io/badge/crypto-ML--KEM--768-blue)]()
[![ElizaOS](https://img.shields.io/badge/ElizaOS-plugin%20compatible-purple)]()
[![ERC-8183](https://img.shields.io/badge/protocol-ERC--8183-orange)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

## Repository

- Plugin package: `packages/plugin-agent-commerce`
- Package name: `@elizaos/plugin-agent-commerce`
- Repository URL: `https://github.com/stvor-hq/ai-security`
- Relay package: standalone secure relay at `src/relay/server.ts`

## What it does

Stvor AI Security protects both sides of agent commerce:

1. **Economic trust** — ERC-8183-compatible job lifecycle for OPEN, FUNDED, SUBMITTED, COMPLETE, REFUND, and ABORTED states.
2. **Information trust** — ML-KEM-768 + Double Ratchet + AES-256-GCM transport for prompts, deliverables, and evaluation payloads.
3. **Runtime safety** — SecurityGuard evaluator blocks non-PQC traffic when `STVOR_STRICT_MODE=true`.
4. **Tamper evidence** — SHA-256 hash-chain audit logging for sensitive agent events.
5. **Payment UX** — x402-style Payment Required flow with a link-cli bridge path for Stripe Skills workflows.

## ElizaOS Quick Start

Install the plugin package in your ElizaOS agent:

```json
{
  "dependencies": {
    "@elizaos/plugin-agent-commerce": "github:stvor-hq/ai-security#packages/plugin-agent-commerce"
  }
}
```

Register the plugin in the character config:

```json
{
  "name": "SecureCommerceAgent",
  "plugins": ["@elizaos/plugin-agent-commerce"],
  "settings": {
    "STVOR_RELAY_URL": "wss://cloud-production-75c5.up.railway.app",
    "STVOR_APP_TOKEN": "your-railway-token",
    "STVOR_STRICT_MODE": "true",
    "STVOR_ALLOW_MOCK": "false"
  }
}
```

The plugin exposes:

- `CREATE_SECURE_JOB`
- `FUND_SECURE_JOB`
- `SUBMIT_DELIVERABLE`
- `JOB_STATUS`
- `SECURITY_GUARD`
- `COMMERCE_TRACKER`
- `COMMERCE_CONTEXT`

## Plugin package structure

```text
packages/plugin-agent-commerce/
├── package.json
├── tsconfig.json
└── src/
    ├── actions.ts
    ├── evaluators.ts
    ├── index.ts
    ├── provider.ts
    └── types.ts
```

The package re-exports the audited commerce plugin logic from `src/plugins/agent-commerce` while keeping the ElizaOS-facing surface area in standard package form. Existing logic is preserved and not deleted.

## PQC transport

Stvor AI Security uses a hybrid post-quantum channel:

| Layer | Algorithm | Purpose |
|---|---|---|
| Classical identity | P-256 X3DH | Agent identity key agreement |
| KEM | ML-KEM-768 | Post-quantum encapsulation |
| Session | Double Ratchet | Forward secrecy and post-compromise security |
| Payload | AES-256-GCM | Authenticated encryption |
| Ledger | SHA-256 | Payload hash attestation only |

Plaintext prompts, API keys, deliverables, and evaluation notes never cross the relay. The relay receives only encrypted envelopes and routing metadata.

## ERC-8183 compliance

The commerce state machine implements the ERC-8183 agent-to-agent escrow flow:

```text
OPEN → FUNDED → SUBMITTED → COMPLETE
                 ↘ REFUND
                 ↘ ABORTED
```

Only hashes and state transitions are recorded in the ledger. The sensitive payload remains in the PQC transport layer.

## Tamper-evident audit logging

`src/core/audit-log.ts` writes hash-chained audit entries:

```text
hash_i = SHA256(timestamp, event, agentId, jobId, details, prevHash)
```

Each entry points to the previous hash, making historical tampering detectable during verification.

## Stripe Skills integration

The project includes an x402-style bridge for Stripe Skills workflows:

- `src/x402/index.ts` generates and verifies `X-Payment` headers.
- Payment-required responses can be bridged into Stripe link-cli flows.
- The bridge keeps payment negotiation separate from encrypted payload transport.

This is intentionally protocol-level: the plugin validates payment metadata but does not expose plaintext work products.

## SecurityGuard strict mode

Set `STVOR_STRICT_MODE=true` to enforce PQC transport at the ElizaOS evaluator boundary.

Strict mode rejects messages unless they include:

```json
{
  "encrypted": true,
  "pqcEncrypted": true,
  "encryption": "ML-KEM-768 + Double Ratchet + AES-256-GCM"
}
```

Messages that are plaintext, missing encryption metadata, or only classically encrypted are blocked.

## Secure Relay deployment

The standalone relay is ready for Railway free-tier deployment.

```bash
bun start:relay
curl http://localhost:4444/health
```

Railway files:

- `railway.json`
- `nixpacks.toml`
- `.railwayignore`

Expected health response:

```json
{"status":"ok","connections":0,"totalMessages":0,"uptimeSeconds":1,"version":"1.0.0"}
```

## Development

```bash
bun install
bun test
bun run type-check
bun --cwd packages/plugin-agent-commerce build
```

## Security Disclaimer

Stvor AI Security is a security layer for agent commerce, not legal, financial, or investment advice. Do not use mock escrow or testnet contracts for real funds. Review relay tokens, private keys, and production environment variables before deploying. Strict mode should remain enabled for production agents that handle secrets, credentials, paid work, or regulated data.

## PR Summary

This PR rebrands the project from Stvor Cloud to Stvor AI Security, adds an ElizaOS-standard `@elizaos/plugin-agent-commerce` package, strengthens strict-mode PQC enforcement, preserves existing ERC-8183 and transport logic, and documents deployment, security assumptions, and Stripe Skills integration for the Nous Research / NVIDIA / Stripe Hackathon submission.
