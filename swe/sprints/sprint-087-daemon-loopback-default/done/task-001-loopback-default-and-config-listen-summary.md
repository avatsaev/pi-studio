# Task 001 — Production daemon binds loopback by default; config `daemon.listen` takes effect — Summary

- **Sprint:** sprints/sprint-087-daemon-loopback-default
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
`DaemonOptions.host/port` are optional; `startDaemon` resolves them from `parseDaemonListen(config.daemon.listen)` (env → config → schema default `127.0.0.1:6767`), explicit options win. `DaemonHandle.listen` reports the bound address. Invalid listen logs, sets `exitCode`, calls `onFatalError`, and throws. `main.ts` no longer computes an address. A test asserts the schema default equals `DEFAULT_DAEMON_LISTEN`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/daemon/bootstrap.ts` | modified |
| `packages/server/src/daemon/main.ts` | modified |
| `packages/server/src/daemon/listen.test.ts` | added tests |

## Build & test results
```
$ npx tsc -b --force            # success
$ npx vitest run packages/server/src/daemon packages/server/src/config packages/cli   # 33 files, 547 passed
$ node packages/server/dist/daemon/main.js   # logs 127.0.0.1:6767; with PI_STUDIO_LISTEN=0.0.0.0:6791 logs 0.0.0.0
```

## Acceptance criteria
- [x] Default binds 127.0.0.1 (test uses a free port via config; parseDaemonListen rejects port 0)
- [x] config honoured, env beats it, opts beat both
- [x] invalid listen → fatal-error contract
- [x] CLI tests pass
- [x] manual check done

## Follow-ups / TODO(verify)
- None.
