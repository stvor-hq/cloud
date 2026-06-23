# @elizaos/plugin-agent-commerce

Policy-focused agent commerce plugin for ElizaOS: ERC-8183 job flow, rate limiting, prompt-injection heuristics, and SHA-256 payload attestation.

This plugin does **not** claim to provide post-quantum encryption. Transport is in-process and policy-checked only.

## Install

```bash
npm install @elizaos/plugin-agent-commerce
# or
bun add @elizaos/plugin-agent-commerce
```

## Usage

```typescript
import { agentCommercePlugin } from '@elizaos/plugin-agent-commerce';

export default {
  plugins: ['@elizaos/plugin-agent-commerce'],
};
```

## Security Model

### Policy enforcement (`SECURITY_GUARD` evaluator)

- Payload size limits
- Rate limiting (in-memory sliding window per agent)
- Prompt-injection heuristics:
  - Instruction override attempts
  - Role confusion patterns
  - Delimiter injection (`</s>`, `[INST]`, `### system`, etc.)
  - Base64-encoded instruction payloads
  - Sensitive exfiltration phrases

Set `STVOR_STRICT_MODE=true` (env or runtime setting) to block violations instead of warning.

### Commerce actions

| Action | Description |
|---|---|
| `CREATE_SECURE_JOB` | Create ERC-8183 job |
| `FUND_SECURE_JOB` | Fund job (requires explicit amount > 0) |
| `SUBMIT_DELIVERABLE` | Submit SHA-256 attested deliverable |
| `JOB_STATUS` | Query job state |

### Memory

Job references are stored via `@elizaos/core` `runtime.createMemory()` — no custom file-backed memory store.

## Development

```bash
bun --cwd packages/plugin-agent-commerce run verify
```

## License

Apache-2.0
