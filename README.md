# Stvor AI Security

Authenticated agent-to-agent commerce node with ElizaOS integration and end-to-end secure transport.

## What it provides

- Ed25519 identity keys for agent authentication
- X25519 + HKDF-SHA256 + AES-256-GCM transport encryption
- Replay protection with timestamp windows and nonce tracking
- SHA-256 payload attestation for job and deliverable state
- ElizaOS plugin for commerce flow, policy checks, and runtime memory integration

## What it does not claim

- No post-quantum cryptography
- No ML-KEM / Kyber
- No Double Ratchet
- No prompt-injection prevention, only heuristics

## Install

```json
{
  "dependencies": {
    "@elizaos/plugin-agent-commerce": "github:stvor-hq/ai-security"
  }
}
```

## Plugin

Use `@elizaos/plugin-agent-commerce` when you want the ElizaOS commerce policy layer.
It provides job flow, prompt-injection heuristics, and SHA-256 attestation.

## Runtime notes

- The transport rejects malformed identity metadata and replayed envelopes.
- Relay compromise does not expose payload plaintext.
- Key material is stored locally with authenticated encryption.

## Development

```bash
bun install
bun run type-check
bun test
```
