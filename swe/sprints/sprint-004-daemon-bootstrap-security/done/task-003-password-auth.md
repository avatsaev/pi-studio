# Task 003 — Optional password auth (bcrypt + bearer)

- **Sprint:** sprint-004-daemon-bootstrap-security
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-002

## Goal
Implement optional shared-secret password authentication for HTTP requests and WebSocket upgrades.

## Scope references
- `clean-room-scope/architecture/auth-security.md` § Password auth, § Behavior
- `clean-room-scope/architecture/config.md` (`daemon.auth.password`)

## What to build
- Password sourced from `auth.password` (config) or `PI_STUDIO_PASSWORD`; **stored bcrypt-hashed**.
- When configured:
  - HTTP: require `Authorization: Bearer <password>` (bcrypt compare).
  - WS upgrade: accept token via subprotocol `Sec-WebSocket-Protocol: pi-studio.bearer.<password>`.
  - Exempt: `GET /api/health` and CORS preflight (`OPTIONS`).
- Reject: `401` (HTTP) / refuse upgrade (WS) on missing/invalid token.

## Out of scope
- Relay E2EE (sprint-013) — password is not a substitute for it.

## Acceptance criteria
- [ ] With a password set, an HTTP request without a valid bearer is rejected; `/api/health` still succeeds.
- [ ] A WS upgrade authenticates via the `pi-studio.bearer.<password>` subprotocol.
- [ ] No password configured → no auth required.
- [ ] No provider API key is ever persisted/transmitted (assert by design; nothing to store).

## Test / verification plan
- Tests: `npx vitest run .../auth.test.ts` — bearer accept/reject, subprotocol path, health exemption.

## Notes
- Browsers can't set custom WS headers, hence the subprotocol carrier.
