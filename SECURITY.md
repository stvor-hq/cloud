# Security Overview — Stvor AI Security

This document summarizes the security hardening and risk controls applied to Stvor AI Security.

## Key Hardening Areas

- **Offline relay resilience**
  - Added `src/transport/mock-relay.ts` as an in-process fallback relay.
  - Transport now automatically falls back when `STVOR_RELAY_URL` is unavailable or probes timeout.
  - This ensures the demo and Dockerized node remain runnable without external relay connectivity.

- **Environment defaults**
  - Added hardcoded safe defaults for all boot-critical variables in `src/core/settings.ts`:
    - `STVOR_MODE`
    - `STVOR_PORT`
    - `STVOR_LOG_LEVEL`
    - `STVOR_DB_PATH`
    - `STVOR_PQC_ENABLED`
    - `STVOR_AGENT_ID`
    - `STVOR_RELAY_URL`
    - `STVOR_API_KEY`
    - `STVOR_APP_TOKEN`
  - This supports zero-config startup for hackathon judges.

- **API authorization**
  - Added `Authorization: Bearer <key>` enforcement for `/api/transport/*` endpoints.
  - The default API key is `stvor-demo-key` for demo mode, but it can be overridden via `STVOR_API_KEY`.
  - Added test coverage for authenticated transport API access.

- **Payload and transport validation**
  - Added `SecurityGuard.assertPayloadSafe()` to normalize and validate payload strings.
  - Rejects control characters, null bytes, and hidden malicious Unicode sequences.
  - Added safe hash verification in `src/transport/pqc.ts` with explicit buffer length checks before `timingSafeEqual`.

- **Docker build and CI smoke test**
  - The `Dockerfile` now runs `bun test --timeout 30000` during build.
  - This catches integration regressions and layer order problems early.

## Notes for Judges

- The project is intentionally self-contained and can run without external network access.
- A local process relay fallback is available when `STVOR_RELAY_URL=local` or when the relay probe fails.
- Security checks are built into both the transport and commerce flow to prevent prompt injections and invalid deliverables.

## Running securely

- Use a custom API key in production: `STVOR_API_KEY=super-secret-key`
- Use a real relay URL in production: `STVOR_RELAY_URL=https://relay.example.com`
- For the demo/hackathon, `STVOR_RELAY_URL=local` is safe and supported.
