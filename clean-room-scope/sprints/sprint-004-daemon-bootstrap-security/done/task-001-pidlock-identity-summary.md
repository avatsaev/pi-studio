# Task 001 — PID lock, server id, daemon keypair, directory layout — Summary

- **Sprint:** sprint-004-daemon-bootstrap-security
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/daemon/identity.ts`:
- `resolvePiStudioHome(env)` — `PI_STUDIO_HOME` or `~/.pi-studio`; `initPiStudioHome` resolves + runs
  `ensureDirectoryLayout`.
- `acquirePidLock(pidPath, { listen, pid?, isAlive? })` — writes `{ pid, startedAt, listen? }`; throws
  `DaemonLockError` if a **live foreign** PID owns the file; reclaims stale (dead PID) or corrupt
  locks. Returns `{ info, release() }` where `release` deletes the file only if still owned.
  `isProcessAlive(pid)` via `process.kill(pid, 0)` (EPERM ⇒ alive).
- `loadOrCreateServerId(home, env)` — persists plain-text `srv_<base64url>`; `PI_STUDIO_SERVER_ID`
  overrides.
- `loadOrCreateDaemonKeypair(home)` — tweetnacl Curve25519 box keypair → `daemon-keypair.json`
  `{ v:2, publicKeyB64, secretKeyB64 }` at mode `0600`; regenerates on unreadable/invalid file.
  `daemonKeypairSchema` validates the shape.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/daemon/identity.ts` | created |
| `packages/server/src/daemon/index.ts` | created (barrel) |
| `packages/server/src/index.ts` | modified — re-exports daemon |
| `packages/server/src/daemon/identity.test.ts` | added — 9 tests |
| `packages/server/package.json` | added deps `tweetnacl` (+ `ws`, `bcryptjs` for later tasks) |

## How it satisfies the scope
- **daemon-bootstrap.md § Behavior / § Shutdown:** PID-lock acquire/reclaim/release, stable server
  id, `loadOrCreateDaemonKeypair`, home resolution + layout reproduce the bootstrap steps.
- **relay-e2ee.md § Data & Persistence:** keypair file shape `{ v:2, publicKeyB64, secretKeyB64 }`,
  mode `0600`, regenerate-if-unreadable.

## Build & test results
```
$ npm run build:server          → exit 0 (no type errors)
$ npx vitest run packages/server/src/daemon/identity.test.ts
 ✓ identity.test.ts (9 tests)
 Test Files  1 passed (1)      Tests  9 passed (9)
$ npx oxlint packages/server   → clean
```

## Acceptance criteria
- [x] Starting a second daemon against the same home fails with a lock error (live foreign PID).
- [x] A stale PID file (dead process) is reclaimed and startup continues.
- [x] `serverId` is stable across restarts for the same home.
- [x] Keypair file is created at mode `0600` and regenerated if unreadable.

## Follow-ups / TODO(verify)
- Exact PID-file JSON shape + reclaim heuristics are TODO(verify) (chose `{ pid, startedAt, listen? }`).
- Keypair uses `tweetnacl` (pure-JS libsodium-compatible Curve25519 box) to avoid a native build;
  byte format matches libsodium box keys (32-byte pub/secret).
