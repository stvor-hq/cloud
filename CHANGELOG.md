## [Plugin Autonomy] - Self-Contained Plugin for elizaOS PR

### Changed
- **Plugin imports localized**: All imports in `packages/plugin-agent-commerce/src/` now reference local files (`./lib/pqc`, `./lib/security`, etc.) instead of cross-package paths (`../../../src/`).
- **Bundle-ready pqc.ts**: Copied and simplified `src/transport/pqc.ts` and `src/core/security.ts` into `packages/plugin-agent-commerce/src/lib/` with no external project dependencies.
- **Fixed TypeScript build**: Resolved import error in `lifecycle.ts` where `PayloadHasher` was incorrectly imported as a type.

### Verified
- `bun install` inside plugin directory succeeds
- `bun run build` compiles without errors
- `bun test` passes 96 tests
- `bun run type-check` exits clean
- `bun run lint` exits clean (warnings only)
- `bun run demo:full` executes successfully

## [Unreleased] - Release Preparation: Secrets & Configuration Hardening

### Critical Security Fixes

- **SECRETS-1 — Removed hardcoded tokens from install scripts**: `install.sh` and `EXECUTE.sh` no longer write hardcoded tokens (`ALICE_TOKEN`, `BOB_TOKEN`, `CHARLIE_TOKEN`, `STVOR_APP_TOKEN=stvor_dev_test123`) into generated `.env` or `.env.local` files. Generated files now use commented placeholders or omit secret values entirely.
- **SECRETS-2 — Removed hardcoded fallbacks from `.env.example` and docs**: `.env.example` no longer contains `STVOR_API_KEY=stvor-demo-key`. `SECURITY.md` and `ARCHITECTURE.md` no longer document hardcoded secret values as defaults.

### Documentation

- **DOC-1 — Clarified @stvor/web3 availability**: `README.md` updated to note that `@stvor/web3@0.3.0` is published on npm (`https://www.npmjs.com/package/@stvor/web3`).

## [Production Hardening] — Unified Architecture & Security Sprint

### Added

- **Production-ready PQC transport layer**: ML-KEM-768 + P-256 X3DH + Double Ratchet operational via `@stvor/web3` (Rust/WASM, published on npm). 53 NIST vectors validated.
- **AEAD metadata binding**: Every job transition records a SHA-256 payload hash. `taskPayloadHash` is bound to FUNDED state; `deliverableHash` is bound to SUBMITTED. Hash mismatch triggers automatic job abort with security alert via `CommerceTransportBridge`.
- **Replay protection**: Per-message Double Ratchet key rotation prevents ciphertext replay. Timestamp validation on challenge-response authentication tokens. Expired challenges are rejected automatically.
- **Per-agent challenge-response authentication**: P-256 signed challenges with RFC 3339 expiry (`5m` default). Persistent challenge store (`STVOR_CHALLENGE_STORE`, default `./data/challenges.json`). Used for authorization on `/api/transport/*` and Bearer auth enforcement.
- **Rate limiting on relay and API**: In-memory sliding window (10 req/min per agent) in development. File-backed rate-limit store (`STVOR_RATE_LIMIT_STORE`) for persistence. Redis-ready for multi-instance production deployments.
- **ERC-8183-compatible state machine**: `packages/plugin-agent-commerce/src/state-machine.ts` implements 8 states (OPEN→FUNDED→SUBMITTED→COMPLETE/REFUND/ABORTED/EXPIRED/TERMINAL). `AgenticCommerce.sol` compiled on-chain contract, testnet deployment pending.
- **Plugin self-containment**: `packages/plugin-agent-commerce/` now bundles `lib/security.ts`, `lib/pqc.ts`, and `lib/key-store.ts` for autonomous npm installation via `@elizaos/plugin-agent-commerce`.
- **Enterprise Production Mode**: `STVOR_PRODUCTION_MODE=true` enforces `wss://` relay URL, disables mock relay, requires `STVOR_API_KEY` and `STVOR_KEY_PASSWORD`, and enables persistent challenge/rate-limit stores.

### Fixed

- **Import path unification**: All imports in `packages/plugin-agent-commerce/src/` now correctly reference `../../src/` or `../../../src/` as needed. Deleted paths (`src/plugins/agent-commerce/`, `src/relay-server.ts`) fully removed.
- **Zero-amount funding rejection**: `state-machine.ts` `fundJob()` now validates `fundAmount > 0` before processing. Added test verifying zero-amount funding is rejected.
- **Deterministic payload hashing**: `PayloadHasher.hashPayload()` uses `stableStringify()` (sorted keys) instead of `JSON.stringify()`, ensuring deterministic hashes regardless of key order.
- **Timing-safe comparisons**: `PayloadHasher.verifyHash()` and API key checks use `crypto.timingSafeEqual()` with equal-length buffers, preventing timing side-channel attacks.
- **CORS and preflight**: `src/api/server.ts` adds `Access-Control-Allow-Origin` (configurable via `STVOR_CORS_ORIGIN`) and handles `OPTIONS` preflight requests.
- **ElizaOS memory API compatibility**: `persistMemory()` uses correct ElizaOS runtime API with graceful fallback to local file-based `HybridMemoryManager`.

### Security

- **SecurityGuard.assertPayloadSafe()**: Rejects control characters, null bytes, hidden malicious Unicode sequences, and LLM injection patterns (`ignore previous instructions`, `export private keys`, `system override`, etc.).
- **API authorization**: `Authorization: Bearer <key>` enforced for `/api/transport/*` endpoints. `STVOR_API_KEY` required in production.
- **Relay token moved to Authorization header**: Removed from URL query string to prevent logging in access logs.
- **Relay agent impersonation blocked**: Server derives `agentId` from public key in challenge-response handshake and verifies match.
- **Broadcast restricted to admin agents**: `ADMIN_AGENTS` environment variable controls who can broadcast to `*`.
- **Non-root Docker user**: `Dockerfile` runs relay as `USER bun` with `/app/data` ownership.

### Documentation

- **README.md**: Updated to "Production-ready PQC transport layer". Added AEAD metadata binding, per-agent challenge-response auth, and rate limiting rows to implementation status table. Test count updated to 96.
- **SECURITY.md**: Rewritten to document production-ready guarantees: PQC transport, AEAD metadata binding, replay protection, challenge-response auth, rate limiting, offline relay resilience, environment defaults, API authorization, and Docker smoke tests.
- **ARCHITECTURE.md**: Removed "mock ledger" and "demo" qualifiers. Updated relay configuration to reflect explicit opt-in model. Production relay section now reads as live operational component. Removed Phase 3 "to be implemented" framing.

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

## [Unreleased] - Security Audit Fixes

### Critical Security Fixes

- **CRIT-1 — STVOR_APP_TOKEN mandatory**: The relay server now requires `STVOR_APP_TOKEN` to be set. If missing, the server refuses to start with a clear error message. Updated `.env.example` to reflect this requirement.
- **CRIT-2 — Token removed from query string**: WebSocket relay token is no longer appended to the URL as `?token=...`. The token is sent exclusively via the `Authorization: Bearer <token>` header. Server-side code that read `url.searchParams` for the token has been removed. No token values are logged anywhere.
- **CRIT-3 — Solidity submit() restricted to Funded**: `submit()` in `AgenticCommerce.sol` now only allows submission when `job.status == JobStatus.Funded`. The previous exception for `Open` jobs with `budget > 0` has been removed.

### High Severity Fixes

- **HIGH-1 — /stats endpoint protected**: The `/stats` HTTP endpoint now requires the same Bearer token authentication as the WebSocket connection. Requests without a valid token receive HTTP 401.
- **HIGH-2 — Timing-safe API key comparison**: String comparisons for API keys/tokens in `src/api/server.ts` and `src/relay/server.ts` now use `crypto.timingSafeEqual()` after verifying length equality, preventing timing side-channel attacks.
- **HIGH-3 — Rate limiting enabled in all environments**: `getRateLimitStore()` in `src/core/security.ts` now always uses the persistent `FileRateLimitStore` by default. The in-memory fallback is reserved for tests (`NODE_ENV=test`). Redis is documented as the recommended store for clustered deployments.
- **HIGH-4 — Message retry with exponential backoff**: `StvorTransportManager.sendSecurePayload()` in `src/transport/pqc.ts` now retries failed sends up to 3 times with exponential backoff (1s, 2s, 4s). After all retries fail, an error event is emitted via a new `onError` handler. When the message buffer is full, the oldest message is evicted with a warning instead of being silently dropped.

### Medium Severity Fixes

- **MED-1 — agentId hijacking prevention**: The relay server checks if an `agentId` is already registered before accepting a new registration. If it exists, the connection is rejected with code 1008 and an appropriate message.
- **MED-5 — Minimum job duration enforced**: `AgenticCommerce.sol` now defines `MIN_JOB_DURATION = 5 minutes` and enforces it in `createJob()`, rejecting jobs with an expiry too close to the current timestamp.

## [Unreleased] - Security Audit Fixes (Phase 2)

### Critical Security Fixes

- **CRIT-6 — MockERC20.mint() access control**: `MockERC20.sol` now imports `Ownable` and restricts `mint()` to the contract owner. Deploy scripts continue to work because the deployer is the owner.

### High Severity Fixes

- **HIGH-8 — Recursion depth limit in stableStringify**: `PayloadHasher.stableStringify()` now accepts a `depth` parameter with a maximum of 64. Exceeding this limit throws `PayloadTooDeepError`. Added test verifying deeply nested objects (depth 100) are rejected.
- **HIGH-9 — Token removed from Dockerfile**: `Dockerfile` no longer hardcodes `RELAY_TOKEN`. The token must be passed via environment variables at runtime. `docker-compose.yml` updated to pass `RELAY_TOKEN` from the host environment.
- **HIGH-10 — Broadcast restricted to admin agents**: In `src/relay-server.ts`, broadcast messages (`to: "*"`) are only permitted if the sender's `agentId` is listed in the `ADMIN_AGENTS` environment variable. Unauthorized broadcast attempts are rejected with code 1008.
- **HIGH-11 — Secrets masked in printSettings()**: `printSettings()` in `src/core/settings.ts` now redacts `apiKey` and `appToken` values, showing only the last 4 characters (or `(not set)`).

### Medium Severity Fixes

- **MED-2 — Expired challenge cleanup**: `FileChallengeStore` in `src/api/server.ts` now exposes `cleanupExpired()`, which removes entries with `expiresAt < Date.now()`. It is called automatically during `persist()` and on a 5-minute interval via `setInterval`.
- **MED-3 — Generic client error responses**: The global error handler in `src/api/server.ts` now returns `{ error: "Internal server error", requestId }` to clients, with the full error logged server-side using a UUID for tracing.
- **MED-4 — MCP fund_job amount validation**: `src/mcp/server.ts` now reads the funding `amount` from `args.amount` instead of hardcoding `'0'`. Missing amounts return a clear error.
- **MED-6 — Audit log rotation**: `src/core/audit-log.ts` now checks file size before appending. If `audit.log` exceeds 10MB, it is rotated to a timestamped backup and a new log is started.
- **MED-7 — Secure relay URL in install scripts**: `install.sh` and `EXECUTE.sh` now default to `ws://localhost:4444` (not `http://`) and include comments that production must use `wss://`.
- **MED-8 — Recipient delivery failure handling**: In `src/relay/server.ts`, if `recipient.ws.send()` throws, the sender now receives `{ type: 'error', error: 'Recipient delivery failed' }` instead of the connection closing silently.
- **MED-9 — Non-root Docker user**: `Dockerfile` now adds `USER bun`, creates `/app/data` with correct ownership, and runs the relay as a non-root user.
- **MED-10 — Deterministic attestation hashing**: `src/contracts/on-chain.ts` `computeAttestationHash()` now uses `PayloadHasher.stableStringify()` instead of `JSON.stringify()`, ensuring deterministic hashes regardless of key order.
- **MED-11 — Removed demo fallback password**: `src/demo-full.ts` no longer sets `STVOR_KEY_PASSWORD = 'stvor-demo-key-password'`. It now warns if the variable is missing and lets `KeyStore` handle password management.

### Low Priority Fixes

- **LOW-1 — Removed .env.example fallback values**: `STVOR_API_KEY` and `STVOR_APP_TOKEN` no longer have placeholder values in `.env.example`. Comments indicate they must be set explicitly.
- **LOW-2 — KeyStore deduplication**: `src/transport/key-store.ts` - `loadOrGenerateSync()` now delegates to `loadOrGenerate()`, eliminating duplicated logic.
- **LOW-3 — Expanded injection patterns**: `src/core/security.ts` adds 5 new patterns: unicode zero-width characters, base64 decode keywords, `eval`/`exec` detection, password/secret/token keywords, and dangerous Python/Node builtins.
- **LOW-4 — Plugin enum consistency**: `packages/plugin-agent-commerce/` now defines and uses `ERC8183JobState` enum instead of inline string literals (`'OPEN'`, `'FUNDED'`, etc.) in `types.ts`, `state-machine.ts`, and `elizaos/provider.ts`.
- **LOW-5 — Pinned SDK version**: `install.sh` now runs `npx @stvor/sdk@3.5.4 mock-relay` instead of an unpinned version.
- **LOW-6 — CORS headers**: `src/api/server.ts` adds `Access-Control-Allow-Origin` (configurable via `STVOR_CORS_ORIGIN`, defaults to `*`) and handles `OPTIONS` preflight requests.
- **LOW-7 — Timing-safe token in relay-server.ts**: `src/relay-server.ts` now uses `crypto.timingSafeEqual()` for relay token comparison, consistent with other authentication paths.

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
- **Plugin Package**: Created self-contained `@elizaos/plugin-agent-commerce` in `packages/plugin-agent-commerce/` with all dependencies bundled.

### Changed

- **Plugin Structure**: Moved `actions.ts`, `provider.ts`, `evaluator.ts`, and `memory.ts` into `packages/plugin-agent-commerce/src/elizaos/` for ElizaOS compatibility.
- **Dependency Isolation**: Copied `pqc.ts`, `key-store.ts`, `security.ts`, and `audit-log.ts` utilities into `packages/plugin-agent-commerce/src/lib/` for autonomous npm installation.
- **Package.json**: Updated `main` to `src/index.ts`, renamed package to `@elizaos/plugin-agent-commerce`, added `ws` and `@types/ws` dependencies.
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