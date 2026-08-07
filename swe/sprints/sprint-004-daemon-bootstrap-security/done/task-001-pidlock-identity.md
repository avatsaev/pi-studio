# Task 001 — PID lock, server id, daemon keypair, directory layout

- **Sprint:** sprint-004-daemon-bootstrap-security
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-001 (sprint-003), task-002 (sprint-003)

## Goal
Implement the daemon's single-owner identity primitives: PID lock, stable server id, persistent
keypair, and `$PI_STUDIO_HOME` resolution + layout.

## Scope references
- `clean-room-scope/architecture/daemon-bootstrap.md` § Behavior (bootstrap steps), § Shutdown
- `clean-room-scope/architecture/relay-e2ee.md` § Data & Persistence (keypair)
- `clean-room-scope/architecture/persistence.md`

## What to build
- `resolvePiStudioHome()` (env `PI_STUDIO_HOME` or `~/.pi-studio`) + `ensureDirectoryLayout`.
- `acquirePidLock(home/pi-studio.pid)`: write `{ pid, startedAt, listen }`; if existing PID alive →
  abort with a clear "another daemon is running" error; stale (dead PID) → reclaim.
- `loadOrCreateServerId(home)`: persist plain-text `srv_<base64url>`, overridable by
  `PI_STUDIO_SERVER_ID`.
- `loadOrCreateDaemonKeypair(home)`: libsodium box (Curve25519) keypair → `daemon-keypair.json`
  `{ v:2, publicKeyB64, secretKeyB64 }` mode `0600`; regenerate if unreadable.

## Out of scope
- HTTP/WS servers (task-002/004). Relay dialing (sprint-013).

## Acceptance criteria
- [ ] Starting a second daemon against the same home fails with a lock error.
- [ ] A stale PID file (dead process) is reclaimed and startup continues.
- [ ] `serverId` is stable across restarts for the same home.
- [ ] Keypair file is created at mode `0600` and regenerated if unreadable.

## Test / verification plan
- Tests: `npx vitest run .../identity.test.ts` — lock contention, stale reclaim, serverId stability,
  keypair mode + regen.

## Notes
- Exact PID-file JSON shape + reclaim heuristics are TODO(verify).
