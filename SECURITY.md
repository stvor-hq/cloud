# Security Notes

This repository implements a real authenticated transport layer (sat-v1).

## Security model

- Identity: Ed25519
- Session key agreement: X25519
- Key derivation: HKDF-SHA256
- Payload protection: AES-256-GCM
- Replay protection: timestamp window plus per-session nonce tracking
- Integrity: envelope signatures plus payload hashes

## Limitations

- Prompt-injection defense is heuristic only.
- The relay, WebSocket layer, and MCP layer are untrusted transport surfaces.
- Cluster-wide rate limiting is not provided by the in-memory guards.

## Operational guidance

- Set `STVOR_STRICT_MODE=true` to turn policy warnings into hard blocks.
- Store keys with a unique `STVOR_KEY_PASSWORD`.
- Do not reuse old key files from previous versions; the loader will regenerate sat-v1 keys when needed.
