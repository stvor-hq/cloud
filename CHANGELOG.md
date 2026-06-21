# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Enterprise Production Hardening

- **Cryptographic randomness**: Replaced `Math.random()` with `crypto.randomBytes()` in `src/agent-identity.ts` and `src/api/server.ts` for challenge generation.
- **Production API key enforcement**: `STVOR_API_KEY` is now required when `NODE_ENV=production` or `STVOR_PRODUCTION_MODE=true`. The default `stvor-demo-key` is rejected in production.
- **Production mode flag**: Added `STVOR_PRODUCTION_MODE`. When enabled:
  - Requires `STVOR_RELAY_URL` with `wss://` scheme.
  - Disables mock relay and `STVOR_ALLOW_MOCK`.
  - Requires `STVOR_API_KEY` and `STVOR_KEY_PASSWORD`.
  - Disables automatic `.stvor_key_pass` generation.
- **Improved crypto error handling**: `sendSecurePayload()` and `dispatchMessage()` now log failures with unique event IDs, agent IDs, and timestamps instead of silently swallowing errors.
- **Persistent rate limiting**: Added `IRateLimitStore` interface with file-based implementation. Automatically enabled in production mode.
- **Persistent challenge storage**: Added `IChallengeStore` interface with file-based implementation. Challenges survive server restarts in production.
- **Relay token enforcement**: `RELAY_TOKEN` is required in production mode for the relay server.
- **Documentation**: Added "Enterprise Production Mode" section to `README.md` and `ARCHITECTURE.md`. Updated `.env.example` with new variables.

## [Unreleased]

### Security Fixes

- **Fixed critical mismatch between security evaluator and transport layer**: transport now adds `pqcEncrypted` flag to message `content`, and the evaluator checks `content.pqcEncrypted === true` instead of requiring a `pqcSignature`. This ensures end-to-end PQC validation actually works in strict mode.

## [Unreleased] - PR Preparation: Plugin Self-Containment

### Security Fixes

- **Relay Fallback**: Removed automatic fallback to mock relay. The production relay URL is now required. Set `STVOR_ALLOW_MOCK=true` explicitly to allow mock relay usage in development or testing environments. In production, missing `STVOR_RELAY_URL` throws an error.
- **KeyStore Password**: Replaced hardcoded default password (`stvor-dev-default-change-in-production`) with cryptographically strong random password generation. When `STVOR_KEY_PASSWORD` is not set, a 32-byte random password is generated and stored in `.stvor_key_pass`. This file is automatically added to `.gitignore`.

### Added

- **Security Evaluator**: New ElizaOS evaluator (`SECURITY_GUARD`) that validates all incoming messages for encryption. Configurable via `STVOR_STRICT_MODE`:
  - `true`: Rejects unencrypted messages with an error
  - `false` (default): Logs a warning but allows the message to proceed
- **SecurityGuard.evaluate()**: New method that returns `SecurityEvaluationResult` with `action: 'BLOCK' | 'ALLOW' | 'WARN'` and `reason` for PQC compliance checking. Useful for testing and programmatic validation.
- **Plugin Package**: Created self-contained `@stvor/plugin-agent-commerce` in `packages/plugin-agent-commerce/` with all dependencies bundled.

### Changed

- **Plugin Structure**: Moved `actions.ts`, `provider.ts`, `evaluator.ts`, and `memory.ts` into `packages/plugin-agent-commerce/src/elizaos/` for ElizaOS compatibility.
- **Dependency Isolation**: Copied `pqc.ts`, `key-store.ts`, `security.ts`, and `audit-log.ts` utilities into `packages/plugin-agent-commerce/src/lib/` for autonomous npm installation.
- **Package.json**: Updated `main` to `src/index.ts`, renamed package to `@stvor/plugin-agent-commerce`, added `ws` and `@types/ws` dependencies.
- **Environment Variables**: Added `STVOR_ALLOW_MOCK` and `STVOR_STRICT_MODE` to `.env.example`
- **Documentation**: Added `packages/plugin-agent-commerce/README.md` with Security Model section explaining PQC necessity, SecurityGuard modes, and Railway deployment.

### Tests

- **PQC Blocking Test**: Added test for ERC-8183 request blocking when PQC metadata is missing in strict mode.
- **Test Count**: All 89 tests passing (up from 86, with 3 failures resolved).

### Technical Details

- `packages/plugin-agent-commerce/src/lib/security.ts`: Added `evaluate()` static method for PQC validation with result object.
- `packages/plugin-agent-commerce/src/elizaos/evaluator.ts`: Enhanced `isPqcEncryptedContent()` to require `pqcSignature` for PQC validation.
- `packages/plugin-agent-commerce/package.json`: Updated structure for npm publication with self-contained dependencies.
- `src/transport/pqc.ts`: Added `shouldAllowMock()`, `getRelayEnvValue()`, and `enforceMockRelay()` methods to the `StvorTransportManager` class
- `src/transport/relay.ts`: Updated `createRelay()` factory to require explicit `STVOR_ALLOW_MOCK=true` for mock relay fallback
- `src/transport/key-store.ts`: Added automatic password generation and `.stvor_key_pass` file management
- `src/transport/interfaces.ts`: Added `encrypted` and `sessionId` fields to `IStvorMessage` interface
- `src/plugins/agent-commerce/elizaos/evaluator.ts`: Added `securityEvaluator` for transport security validation
- `src/plugins/agent-commerce/elizaos/index.ts`: Registered `securityEvaluator` in the plugin

## [Unreleased] - Production Blocker Resolution

### Critical Fixes

- **CRIT-1 — PQC encryption now functional**: `StvorTransportManager.sendSecurePayload()` encrypts plaintext payloads with `HybridPQCTransport.encryptOnce()` before sending. The ciphertext (base64-encoded) replaces `content.data`, while the original plaintext hash is stored in `metadata.payloadHash` for ledger attestation. If recipient public keys are unavailable, the method throws a clear `PqcEncryptionError`.
- **CRIT-2 — Job endpoint authentication**: All mutating job endpoints (`/api/jobs/create`, `/api/jobs/:id/fund`, `/api/jobs/:id/submit`, `/api/jobs/:id/evaluate`) now enforce `requireTransportAuth(req)` before processing, rejecting unauthenticated requests with 401.
- **CRIT-3 — Relay agentId verification**: The WebSocket relay server now requires a challenge-response handshake before registering an `agentId`. On connection, the server sends a random challenge; the client must respond with a signature over that challenge using `verifyChallenge()` from `agent-identity.ts`. Registration is refused on verification failure.
- **HIGH-4 — Rate limiting wired to API**: All mutating API endpoints (jobs, transport, x402) now call `SecurityGuard.checkRateLimit(agentId)` before processing. Requests exceeding the limit receive HTTP 429.

### Added

- **Encryption test**: `tests/commerce-flow.test.ts` includes a new test that verifies the sent payload is ciphertext and that the recipient can decrypt it back to the original plaintext using `MockRelayClient`.

### Changed

- `src/transport/pqc.ts`: Added `peerPublicKeys` registry and `registerPeerPublicKey()` for recipient key discovery. `MockRelayClient` now delivers messages directly to the recipient's handler, and `StvorTransportManager` properly wires relay handlers in mock mode.
- `src/transport/mock-relay.ts`: Updated `send()` signature to accept `IStvorMessage` directly, preserving encryption metadata through the mock relay.
- `src/transport/relay.ts`: Extended `RelayMessage` type to include challenge-response fields (`challenge`, `signature`, `publicKey`, `expiresAt`).