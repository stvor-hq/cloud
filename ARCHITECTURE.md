# Architecture

## Overview

The repository contains two main surfaces:

- `src/`: the authenticated transport node, API, relay, and runtime helpers
- `packages/plugin-agent-commerce/`: the ElizaOS commerce plugin

The secure transport is `sat-v1`:

- Ed25519 identity keys
- X25519 session establishment
- HKDF-SHA256 key derivation
- AES-256-GCM payload encryption
- Envelope signatures for sender authentication
- Timestamp and nonce replay protection

## Message flow

1. Sender registers the recipient identity.
2. Sender encrypts a payload into a signed envelope.
3. Relay forwards the envelope without plaintext visibility.
4. Receiver verifies the signature, timestamp, nonce, and payload hash.
5. Receiver decrypts the payload and hands it to the ElizaOS runtime.

## Persistence

- Identity keys are stored locally with authenticated encryption.
- Session state is kept in memory and reloaded through the runtime bootstrap path.
- The plugin uses runtime memory for job references; it does not keep a separate file-backed job store.

## Policy layer

The ElizaOS plugin includes heuristic prompt-injection detection and rate limiting.
It does not claim to prevent prompt injection.

## Protocol versioning

The sat-v1 protocol version is explicit so future algorithm upgrades can be introduced without redefining the message envelope.
