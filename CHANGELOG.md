# Changelog

All notable changes to this project will be documented in this file.

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