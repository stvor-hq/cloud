# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - Security Hardening Update

### Security Fixes

- **Relay Fallback**: Removed automatic fallback to mock relay. The production relay URL is now required. Set `STVOR_ALLOW_MOCK=true` explicitly to allow mock relay usage in development or testing environments. In production, missing `STVOR_RELAY_URL` throws an error.
- **KeyStore Password**: Replaced hardcoded default password (`stvor-dev-default-change-in-production`) with cryptographically strong random password generation. When `STVOR_KEY_PASSWORD` is not set, a 32-byte random password is generated and stored in `.stvor_key_pass`. This file is automatically added to `.gitignore`.

### Added

- **Security Evaluator**: New ElizaOS evaluator (`SECURITY_GUARD`) that validates all incoming messages for encryption. Configurable via `STVOR_STRICT_MODE`:
  - `true`: Rejects unencrypted messages with an error
  - `false` (default): Logs a warning but allows the message to proceed

### Changed

- **Environment Variables**: Added `STVOR_ALLOW_MOCK` and `STVOR_STRICT_MODE` to `.env.example`
- **Documentation**: Updated ARCHITECTURE.md and README.md with new security configurations

### Technical Details

- `src/transport/pqc.ts`: Added `shouldAllowMock()`, `getRelayEnvValue()`, and `enforceMockRelay()` methods to the `StvorTransportManager` class
- `src/transport/relay.ts`: Updated `createRelay()` factory to require explicit `STVOR_ALLOW_MOCK=true` for mock relay fallback
- `src/transport/key-store.ts`: Added automatic password generation and `.stvor_key_pass` file management
- `src/transport/interfaces.ts`: Added `encrypted` and `sessionId` fields to `IStvorMessage` interface
- `src/plugins/agent-commerce/elizaos/evaluator.ts`: Added `securityEvaluator` for transport security validation
- `src/plugins/agent-commerce/elizaos/index.ts`: Registered `securityEvaluator` in the plugin