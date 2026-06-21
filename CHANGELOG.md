## [Unreleased] - Security Audit Fixes for elizaOS PR Readiness

### Critical Security Fixes

- **BUG-1 — Replaced custom Keccak-256 with auditable library**: Removed the hand-rolled Keccak-256/SHA-3 implementation from `src/agent-identity.ts` (functions `rotl`, `keccakF`, `absorbBlocks`, `keccak256`). Replaced with `keccak_256` from `@noble/hashes/sha3`, eliminating side-channel risk and ensuring compatibility with the standard test vector (`c5d246...`).
- **BUG-3 — Deterministic payload hashing**: `PayloadHasher.hashPayload()` no longer relies on non-deterministic `JSON.stringify()` key ordering. Replaced with `stableStringify()` that sorts object keys alphabetically before serialization. Added regression test verifying that reordered key payloads produce identical hashes.
- **BUG-4 — Timing-safe hash comparison**: `PayloadHasher.verifyHash()` now uses `crypto.timingSafeEqual()` instead of the `===` string comparison. Both inputs are converted to `Buffer` objects of equal length before comparison, preventing timing side-channel attacks on authentication tag verification.
- **BUG-7 — Relay token moved to Authorization header**: Removed WebSocket relay token from URL query string (which is logged in access logs and browser history). Token is now sent as `Authorization: Bearer <token>` header. Updated both `src/transport/relay.ts` (client) and `src/relay-server.ts` / `src/relay/server.ts` (server). Removed server-side token logging.
- **BUG-7b — Relay agent impersonation blocked**: The relay server now derives the `agentId` from the public key provided in the challenge-response handshake using `deriveAgentIdFromPublicKey()` and verifies it matches the originally requested `agentId`. Registration is refused if the public key does not map to the claimed agent identity.
- **BUG-8 — ElizaOS memory API compatibility**: Fixed `persistMemory()` in `src/plugins/agent-commerce/elizaos/memory.ts` to use the correct ElizaOS runtime API (`runtime.messageManager.createMemory` or `runtime.databaseAdapter.createMemory` or `runtime.createMemory`) instead of the non-existent `runtime.getMemoryManager()`. Includes graceful fallback to local file-based `HybridMemoryManager` for environments without ElizaOS persistence.
- **BUG-16 — Removed silent stub methods**: `StvorTransportManager.receiveSecureMessage()` and `getSessionStatus()` no longer silently return `null`. Both now throw `NotImplementedError` with a clear message directing users to `onMessage()` for event-driven handling, preventing silent logic failures in production code.

### Additional Security Fixes for PR

- **SEC-1 — SecurityGuard integration in securityEvaluator**: The `securityEvaluator` in `packages/plugin-agent-commerce/src/elizaos/evaluator.ts` now calls `SecurityGuard.assertPayloadSafe()` on all incoming messages, including PQC-encrypted ones. This ensures prompt injection attacks are blocked even if the message has `pqcEncrypted: true`. In strict mode (`STVOR_STRICT_MODE=true`), malicious payloads throw an error; in non-strict mode, a warning is logged.
- **SEC-2 — Cryptographic payload signatures**: `PayloadHasher.signPayload()` and `PayloadHasher.verifySignature()` now use `wasm_ec_sign()` and `wasm_ec_verify()` from `@stvor/web3/wasm` to sign and verify SHA-256 payload hashes. This provides both integrity and authenticity verification. Tests verify signed payloads can be validated and tampered payloads fail.
- **SEC-3 — Zero budget funding rejection**: Fixed `fund()` in `AgenticCommerce.sol` to revert with `ZeroBudget()` error when `job.budget == 0`. The mock state machine (`state-machine.ts`) now also validates `fundAmount > 0` before processing funding requests. Added test verifying zero-amount funding is rejected.

# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - Enterprise Production Hardening

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

## [Unreleased] - Security Fixes

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
- **Test Count**: All 95 tests passing (up from 91, with 4 new security tests added).

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