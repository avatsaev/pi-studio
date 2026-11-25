# Task 002 — A daemon open to the network refuses to start without a password — Summary

- **Sprint:** sprints/sprint-146-close-the-door
- **Completed:** 2026-11-24
- **Status:** done

## What was implemented
`startDaemon` checks right after the listen address is resolved, before the pid lock: a non-loopback host with no password (env or config) logs an error naming `PI_STUDIO_PASSWORD` and `daemon.auth.password`, sets `process.exitCode = 1`, calls `onFatalError` with code `unprotected_bind`, and throws; nothing listens. `startDevDaemon` refuses every non-loopback host the same way. `pi-studio daemon start`/`restart` check the rule before spawning (text: stderr; `--json`: `{up:false,host,port,error:"unprotected_bind"}`, exit 1). `UNPROTECTED_BIND_WARNING`, `DaemonHandle.exposedWithoutPassword` and the `run.ts` suffix are removed.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/daemon/loopback.ts`, `index.ts` | `isUnprotectedBind`, `unprotectedBindMessage`, `unprotectedBindError`, `UNPROTECTED_BIND_CODE` |
| `packages/server/src/daemon/bootstrap.ts`, `dev-bootstrap.ts`, `run.ts` | refusal; warning removed |
| `packages/server/src/daemon/listen.test.ts` | tests |
| `packages/cli/src/daemon-commands.ts`, `daemon-commands.test.ts` | pre-spawn check; tests |
| root `AGENTS.md`/`README.md`, server and cli `AGENTS.md`/`README.md`, fern daemon pages | rule documented |

## How it satisfies the scope
Handoff finding S2. Desktop entries bind loopback: SSH runs the remote CLI with `-H 127.0.0.1:<port>` (`remote_supervisor/scripts.rs:148`); the local entry runs `--json daemon <verb>` with the CLI default `127.0.0.1:6767` (`supervisor.rs:331`).

## Build & test results
```
$ npx vitest run packages/server/src/daemon packages/cli/src   -> 36 files, 533 passed
$ npm run build:server && npm run build:cli                    -> success
$ live probe, temp home, port 47311: PI_STUDIO_LISTEN=0.0.0.0:47311, no password -> exit 1, unprotected_bind, nothing listening
$ same with PI_STUDIO_PASSWORD set -> started, listening on 0.0.0.0:47311 (killed afterwards)
$ Wave gate (full tree, once, after tasks 001-005): `npm run build` exit 0; `npm run typecheck` exit 0; `npm run lint` exit 0 (existing warnings only); `npm test`: 329 of 330 files pass, 4727 of 4728 tests pass. The one failure, `packages/server/src/daemon/bootstrap.test.ts` > "extension packs RPC ... full round trip", fails identically on a pristine checkout of HEAD `a6efaa9a` (checked in a temporary worktree), so it is not caused by this sprint. `npm run fmt:check` reports 25 files; the 8 docs/compose files this sprint touched were already unformatted at HEAD.
```

## Acceptance criteria
- [x] No password on `0.0.0.0`: non-zero exit, log says why, nothing listens (live)
- [x] With `PI_STUDIO_PASSWORD`: starts (live)
- [x] Loopback without password starts as before (test)
- [x] `--json daemon start` reports `unprotected_bind` (unit test through a fake runtime, not a spawned CLI)
- [x] Desktop entries unaffected (read-only check above)

## Follow-ups / TODO(verify)
- Task-006 repeats the live probe against the built CLI.
