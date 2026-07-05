# Task 002 — Daemon relay transport + bootstrap wiring

- **Sprint:** sprint-017-relay-e2ee
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** task-001; task-005 (sprint-004, bootstrap)

## Goal
Wire the daemon's outbound relay connection into bootstrap with E2EE gating.

## Scope references
- `clean-room-scope/architecture/relay-e2ee.md` § Behavior (connection setup), § TLS
- `clean-room-scope/architecture/daemon-bootstrap.md` § Behavior (connectRelay)
- `clean-room-scope/architecture/config.md` (`daemon.relay`)

## What to build
- `relay-transport.ts`: dial outbound WebSocket to the relay endpoint; register a session id; use the
  daemon channel (task-001) so daemon↔client app traffic is E2EE. Daemon refuses to process app
  messages before the handshake completes.
- Bootstrap: when `config.daemon.relay.enabled`, `connectRelay(keypair, config.daemon.relay)` after
  the WS server is up; `close()` closes the relay transport.
- TLS: `useTls`/`PI_STUDIO_RELAY_USE_TLS` and independent `publicUseTls`/`PI_STUDIO_RELAY_PUBLIC_USE_TLS`;
  config fields `endpoint`, `publicEndpoint`, `useTls`, `publicUseTls`, `enabled`.
- Reconnect on relay drop (new session → new keys).

## Out of scope
- Client transport (task-003). CF server adapter (task-004).

## Acceptance criteria
- [ ] With `relay.enabled`, the daemon dials outbound and registers a session id.
- [ ] App messages are refused until the per-connection handshake completes.
- [ ] Relay drop triggers reconnect with fresh session keys.
- [ ] `close()` tears down the relay transport.

## Test / verification plan
- Tests: `npx vitest run .../relay-transport.test.ts` against a fake relay endpoint — dial+register,
  handshake-before-traffic, reconnect.

## Notes
- The daemon secret never leaves the daemon; relay sees only metadata + plaintext public keys.
