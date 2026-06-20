# Stvor Cloud Pitch

## The bet we're making

Quantum computers will eventually break ECDSA and Ed25519. The dangerous window is not only when they arrive; it is the years between “quantum computers exist” and “every agent system has upgraded,” because any plaintext or classically encrypted traffic intercepted today can be decrypted later. Stvor Cloud is the hedge: an ERC-8183 commerce layer where escrowed funds and agent secrets are protected together.

## What we actually built (not claimed — built)

- Built `@stvor/web3` — Rust/WASM PQC SDK, 53 NIST test vectors,
  zero npm dependencies → `cargo test` in github.com/sapogeth/web3-sdk
- Stvor Cloud runs on our own verified crypto, not a third-party library
- Same SDK supports TON Web3, EVM AA (Safe, ZeroDev, Biconomy), agent commerce
- Real ML-KEM-768 via `@stvor/web3` → `bun test tests/crypto.test.ts`
- Real ERC-8183 state machine with 5 states → `bun test tests/commerce-flow.test.ts`
- Real ElizaOS plugin (4 actions, 1 provider, 2 evaluators) → `bun test tests/elizaos-plugin.test.ts`
- Real cinematic demo → `bun start:demo`

## What's mocked (honest)

- Relay: in-process mock (production relay is Phase 3)
- Reputation gate: in-memory mock (Solana oracle is Phase 3)
- Ledger: mock ledger (no live chain, hash attestation logic is real)

## Security model

Stvor Cloud separates funds from secrets because they fail in different ways. The ERC-8183 ledger protects economic trust: who created the job, who funded it, what state it is in, and which hashes were submitted. The transport protects information trust: prompts, API keys, deliverables, and evaluation data never cross the relay as plaintext.

Hybrid X25519 + ML-KEM-768 is stronger than either alone. X25519 gives fast, mature classical key agreement. ML-KEM-768 adds NIST-selected post-quantum key encapsulation. The AES-256-GCM key is derived from both secrets with SHA-256, so an attacker must break the classical exchange and the post-quantum encapsulation to decrypt.

SecurityGuard protects decrypted payloads before they reach an agent reasoning loop. It rejects oversized payloads, control characters, and known prompt-injection patterns such as instruction overrides, private-key exfiltration, DAN-style role breaks, and script tags. It is a runtime filter, not a complete AI-safety solution: it reduces high-confidence attack patterns, but it does not make arbitrary model behavior formally safe.

## Why ERC-8183 + PQC is the right combination

ERC-8183 creates economic trust: jobs, funding, deliverable hashes, evaluation, and settlement. PQC creates information trust: the payloads that drive agent work stay confidential and authenticated in transit. One without the other is incomplete. Secure escrow without encrypted payloads still leaks the work. Encrypted transport without escrow still leaves payment and settlement trust unresolved. Stvor Cloud combines them into one agentic commerce primitive.

## Judge instructions

```text
┌─────────────────────────────────────────────┐
│  To verify everything in 5 minutes:         │
│                                             │
│  git clone github.com/stvor-hq/cloud       │
│  ./install.sh                               │
│  bun start:demo          ← watch the story  │
│  bun test                ← 23 green lights  │
└─────────────────────────────────────────────┘
```
