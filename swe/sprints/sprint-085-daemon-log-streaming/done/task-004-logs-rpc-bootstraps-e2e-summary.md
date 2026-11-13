# Task 004 — Handlers, tap wiring in both bootstraps, dev-daemon E2E incl. redaction scenario — Summary

- **Sprint:** sprints/sprint-085-daemon-log-streaming
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
`registerDaemonLogsHandlers` (`observability/daemon-logs-rpc.ts`). Both bootstraps gained an optional `logTap` option; they create a `LogTap` when absent and pass it to `createDaemonLogger` only when they build their own logger, construct `DaemonLogsService`, register the handlers, dispose per-session state from `onSessionClose` (production also in `resetRelaySession`) and the service on `close()`. Shared test harness `test-support/auth-gated-rpc.ts` (password-protected server, 401 probe, authenticated RPC) now also backs the status auth test.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/observability/daemon-logs-rpc.ts` | created |
| `packages/server/src/daemon/bootstrap.ts`, `dev-bootstrap.ts` | `logTap` option, service, handlers, disposal |
| `packages/server/src/daemon/daemon-logs-e2e.test.ts` | added (7 tests) |
| `packages/server/src/test-support/auth-gated-rpc.ts` | created (shared auth harness) |
| `packages/server/src/daemon/daemon-status-e2e.test.ts` | auth test moved onto the shared harness |
| `packages/server/AGENTS.md` | layout + Observability log-streaming paragraph |

## How it satisfies the scope
E2E on the dev daemon with a tapped injected logger sharing the tap via `logTap`: live delivery, `minLevel` filter (`effectiveLevel` is the stricter level), `tail` backlog, `invalid_level` domain failure, unsubscribe and closed-socket stop pushes, `silentLogger()` daemon -> `ok:true`, `effectiveLevel:"silent"`, no lines. Redaction scenario at `trace`: agent created with a sentinel prompt, a `#ui` input dialog with a sentinel payload answered with a sentinel; no pushed or backlogged line contains any sentinel (no call-site fix was needed). Auth: a password-protected server rejects an unauthenticated upgrade (401) and serves an authenticated socket. Only real waits are the 100 ms flush (+250 ms negative-assert settle). `server_info.features` unchanged.

## Build & test results
```
$ npm run build && npm run typecheck && npm run lint -> success (pre-existing warnings only)
$ npm test -> 255 files, 3381 tests passed
$ npm run fmt:check -> none of this task's files listed (baseline failures elsewhere)
```

## Acceptance criteria
- [x] All scenarios pass.
- [x] `server_info.features` unchanged (flag is task-005).

## Follow-ups / TODO(verify)
- Production `startDaemon` log-stream wiring shares the dev code path; not separately E2E-tested.
