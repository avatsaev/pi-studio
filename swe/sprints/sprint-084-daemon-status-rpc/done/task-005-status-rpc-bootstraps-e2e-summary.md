# Task 005 — Handlers in both bootstraps, session-close disposal, dev-daemon E2E — Summary

- **Sprint:** sprints/sprint-084-daemon-status-rpc
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
`registerDaemonStatusHandlers` (`observability/daemon-status-rpc.ts`) for the one-shot, subscribe and unsubscribe requests (domain results in `payload`, `requestId` stamped by the router). Both bootstraps construct `DaemonStatusService` right before the agent manager (agents read lazily via `manager.list()`), register the handlers, call `disposeSession` from `onSessionClose` (production also from the relay `resetRelaySession` path) and `dispose()` on `close()`. The dev bootstrap spreads `getActiveSessions()` into an array because its holder is an `Iterable`. Not advertised: `server_info.features` unchanged.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/observability/daemon-status-rpc.ts` | created |
| `packages/server/src/daemon/bootstrap.ts` | service, handlers, session-close + relay-reset disposal, shutdown |
| `packages/server/src/daemon/dev-bootstrap.ts` | service, handlers, `onSessionClose`, shutdown |
| `packages/server/src/daemon/daemon-status-e2e.test.ts` | added (5 tests) |

## How it satisfies the scope
E2E on the dev daemon with two clients (one `appVersion:"pistudiodashboard/0.1.0"`): response shape, archived agents excluded from `agentsByStatus`, `clients[]` ordered with requester, `transport` and `remoteAddress`, push/unsubscribe/closed-socket. The 5 s interval is driven by fake `setInterval`/`clearInterval` only (no real 5 s waits); `vi.getTimerCount()` reaching 0 after the last subscriber's socket closes proves disposal. Auth: with a password-protected `createWebSocketServer` an unauthenticated upgrade gets 401 and a bearer-subprotocol socket gets `daemon_status_response`.

## Build & test results
```
$ npm run build:server -> success
$ npx vitest run packages/server/src/daemon packages/server/src/observability -> 109 passed, 0 failed
$ npx oxfmt / oxlint (changed files) -> clean
```

## Acceptance criteria
- [x] E2E criteria pass without real 5 s waits.
- [x] `server_info.features.daemonObservability` still undefined (asserted).
- [x] Existing daemon tests pass.

## Follow-ups / TODO(verify)
- Production `startDaemon` handlers are covered by shared wiring only; the E2E runs on the dev daemon.
