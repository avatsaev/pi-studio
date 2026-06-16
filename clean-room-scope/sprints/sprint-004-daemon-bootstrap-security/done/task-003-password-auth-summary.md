# Task 003 — Optional password auth (bcrypt + bearer) — Summary

- **Sprint:** sprint-004-daemon-bootstrap-security
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/auth/password-auth.ts`:
- `resolvePasswordHash({ configPassword, envPassword })` — env wins; a plaintext secret is
  bcrypt-hashed, an existing `$2[aby]$` hash is used as-is; `undefined` when unconfigured.
  `isBcryptHash` detects the hash form.
- `createPasswordAuth(passwordHash?)` → `PasswordAuth` with `enabled`, `verify(token)` (bcrypt
  compare), `authenticateHttp(req)` (Authorization `Bearer` header), and `authenticateUpgrade(req)`
  (WS `Sec-WebSocket-Protocol: pi-studio.bearer.<password>`). When disabled, everything is allowed.
- Helpers `bearerFromAuthHeader` and `bearerFromSubprotocol` (comma-separated subprotocol list).
- Wires into the existing HTTP pipeline via the `authenticate` hook (health + preflight already
  short-circuit before it, so they stay exempt). Uses `bcryptjs` (pure-JS, no native build).

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/auth/password-auth.ts` | created |
| `packages/server/src/auth/index.ts` | created (barrel) |
| `packages/server/src/index.ts` | modified — re-exports auth |
| `packages/server/src/auth/password-auth.test.ts` | added — 7 tests |
| `packages/server/package.json` | `bcryptjs` dependency (+ `@types/bcryptjs`) |

## How it satisfies the scope
- **auth-security.md § Password auth / § Behavior:** bcrypt-hashed storage, HTTP bearer requirement,
  WS subprotocol token carrier, health/preflight exemption, 401 / refuse-upgrade on invalid token.
- **config.md (`daemon.auth.password`) + env precedence:** `PI_STUDIO_PASSWORD` overrides config.

## Build & test results
```
$ npm run build:server          → exit 0 (no type errors)
$ npx vitest run packages/server/src/auth/password-auth.test.ts
 ✓ password-auth.test.ts (7 tests)
 Test Files  1 passed (1)      Tests  7 passed (7)
$ npx oxlint packages/server   → clean
```

## Acceptance criteria
- [x] With a password set, an HTTP request without a valid bearer is rejected (401); `/api/health`
      still succeeds (200); a valid bearer passes through (404 no-route).
- [x] A WS upgrade authenticates via the `pi-studio.bearer.<password>` subprotocol (wrong/missing rejected).
- [x] No password configured → no auth required (`enabled:false` allows all).
- [x] No provider API key is ever persisted/transmitted — by design; the module only handles the
      password hash (verified: nothing else stored, no fs/key surface).

## Follow-ups / TODO(verify)
- Whether `daemon.auth.password` in config is always a pre-computed hash vs. plaintext is handled
  defensively (`isBcryptHash` branch); exact production convention is TODO(verify).
- The WS upgrade enforcement is consumed by the WS server in task-004.
