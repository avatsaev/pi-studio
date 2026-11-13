# Task 002 — Warn on an unprotected non-loopback bind; dev daemon binds loopback too — Summary

- **Sprint:** sprints/sprint-087-daemon-loopback-default
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
`daemon/loopback.ts` adds `isLoopbackHost` and `UNPROTECTED_BIND_WARNING`. `startDaemon` logs one `warn` after bind when the host is non-loopback and no password hash is set, and exposes `DaemonHandle.exposedWithoutPassword`; `main.ts` echoes it in the banner. `dev-main.ts` drops its `0.0.0.0` default (falls back to `DEFAULT_DAEMON_LISTEN`); `startDevDaemon` warns on any non-loopback bind. The production pieces (loopback.ts, bootstrap warning, main.ts banner) landed in the task-001 commit because they share files; the dev daemon changes are in this commit.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/daemon/loopback.ts` | created |
| `packages/server/src/daemon/bootstrap.ts`, `main.ts` | modified |
| `packages/server/src/daemon/dev-main.ts`, `dev-bootstrap.ts` | modified |
| `packages/server/src/daemon/listen.test.ts` | added tests (table + captured-logger) |

## Build & test results
```
$ npx tsc -b --force   # success
$ npx vitest run packages/server/src/daemon   # passed (listen.test.ts 15 tests)
```

## Acceptance criteria
- [x] isLoopbackHost table test
- [x] exactly one warn on 0.0.0.0 without password; none with password / loopback
- [x] dev daemon clean env binds 127.0.0.1 (by code: DEFAULT_DAEMON_LISTEN; not separately launched)
- [ ] Docker compose run — TODO(verify): not run.

## Follow-ups / TODO(verify)
- Docker compose smoke not run.
