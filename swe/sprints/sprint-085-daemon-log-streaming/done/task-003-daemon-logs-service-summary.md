# Task 003 — DaemonLogsService — Summary

- **Sprint:** sprints/sprint-085-daemon-log-streaming
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
`DaemonLogsService` (`packages/server/src/observability/daemon-logs-service.ts`) with injected `tap`, `send`, monotonic `now`, `timers`. Subscribe validation (`invalid_level`/`invalid_tail`, existing sub untouched on error), replace-on-resubscribe with fresh bucket, backlog from `tap.backlog`, `effectiveLevel` (stricter of daemon/min level, `"silent"` if unattached). Per-subscriber 200/s bucket (burst 200), per-subscriber 100 ms flush timer only while pending, <= 200 lines per push, incremental `dropped` (empty `lines` push allowed), send failure removes the subscriber. The tap listener is registered only while >= 1 subscriber exists.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/observability/daemon-logs-service.ts` | created |
| `packages/server/src/observability/daemon-logs-service.test.ts` | created (9 tests) |
| `packages/server/AGENTS.md` | layout entry |

## Build & test results
```
$ npx vitest run packages/server/src/observability packages/server/src/logging -> 35 passed, 0 failed
$ npm run build:server                                                          -> success
$ npx oxlint / oxfmt (changed files)                                            -> clean
```

## Acceptance criteria
- [x] 1000-line burst -> 200 delivered, dropped = 800, trailing empty push (tests)
- [x] second subscriber gets its own quota
- [x] warn never sees info/debug; re-subscribe at info delivers info
- [x] debug request on info daemon -> `effectiveLevel:"info"`
- [x] no push / no timer after unsubscribe, dispose, send failure, or with zero subscribers
- [x] `tail:1001` / `minLevel:"loud"` rejected, previous subscription still active

## Follow-ups / TODO(verify)
- RPC handlers, `daemonObservability` flag, bootstrap wiring and session-close composition are task-004/005.
