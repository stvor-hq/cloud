# Stvor AI Security Skill

Stvor AI Security is an ElizaOS plugin package for quantum-resistant agent commerce. It combines ERC-8183-compatible escrow workflows, ML-KEM-768 post-quantum transport, tamper-evident audit logging, and prompt-injection protection.

## When to use

Use this skill when an ElizaOS agent needs to:

- Create paid agent-to-agent jobs with escrow semantics.
- Send encrypted prompts, deliverables, or evaluation payloads.
- Enforce PQC transport before processing sensitive messages.
- Track ERC-8183 job state transitions.
- Produce SHA-256 attestations without exposing plaintext payloads.
- Bridge x402-style payment-required flows into Stripe Skills/link-cli workflows.

## Plugin package

```text
packages/plugin-agent-commerce
```

Package name:

```text
@elizaos/plugin-agent-commerce
```

## Character config

```json
{
  "plugins": ["@elizaos/plugin-agent-commerce"],
  "settings": {
    "STVOR_RELAY_URL": "wss://cloud-production-75c5.up.railway.app",
    "STVOR_APP_TOKEN": "your-railway-token",
    "STVOR_STRICT_MODE": "true",
    "STVOR_ALLOW_MOCK": "false"
  }
}
```

## Actions

- `CREATE_SECURE_JOB`: create an ERC-8183-compatible job.
- `FUND_SECURE_JOB`: fund a job and prepare encrypted task delivery.
- `SUBMIT_DELIVERABLE`: submit a deliverable hash for evaluation.
- `JOB_STATUS`: inspect job state.

## Evaluators

- `SECURITY_GUARD`: rejects plaintext or non-PQC messages when `STVOR_STRICT_MODE=true`.
- `COMMERCE_TRACKER`: extracts job IDs and persists commerce context.

## Provider

- `COMMERCE_CONTEXT`: exposes active job summaries and transport status.

## Security model

Stvor AI Security separates economic trust from information trust:

1. ERC-8183 state transitions track who created, funded, submitted, evaluated, and settled a job.
2. ML-KEM-768 + Double Ratchet + AES-256-GCM protects prompts, API keys, deliverables, and evaluation data.
3. Audit logs are hash-chained so historical tampering is detectable.
4. Strict mode blocks any ElizaOS message that does not prove PQC encryption metadata.

## Security disclaimer

Do not use mock escrow, testnet deployments, or local relays for real money or real secrets. Always rotate relay tokens and never commit `.env`, `.env.local`, `.env.production`, `.stvor_key_pass`, or private keys.
