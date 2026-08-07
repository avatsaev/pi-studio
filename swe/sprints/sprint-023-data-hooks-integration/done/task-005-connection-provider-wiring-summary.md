# Task 005 — Connection Provider & App-Level Wiring — Summary

- **Sprint:** sprint-023-data-hooks-integration
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

`ConnectionProvider` — the app-level React component that initiates and manages the daemon
WebSocket connection. Wires the `PiStudioClient` into the React tree via `ClientProvider`,
subscribes the session store to broadcast events, and drives boot gate state.

### Files created / modified
| File | Change |
|------|--------|
| `packages/app/src/providers/ConnectionProvider.tsx` | Created — full connection provider |
| `packages/app/src/providers/AppProviders.tsx` | Modified — wraps children in ConnectionProvider |
| `packages/app/src/providers/index.ts` | Modified — exports ConnectionProvider types |
| `packages/app/src/providers/connection-provider.test.ts` | Created — 12 tests |

## How it satisfies the scope

| Scope requirement | Implementation |
|---|---|
| Connect to daemon on startup | On mount, reads address from KV → creates `DaemonClient` + `PiStudioClient` → calls `connect()` |
| Drive boot gate: no-hosts → Welcome; connected → Home | `AppConnectionStatus` enum: `no-hosts` / `connecting` / `connected` / `reconnecting` / `error` — consumed by `BootGate` |
| Subscribe session store to broadcast events | `subscribeSessionStore(piClient)` called on connect; unsubbed on cleanup |
| Auto-reconnect with backoff | `ReconnectionManager` from `@av-pi-studio/client`; on reconnect: invalidates session queries + repopulates server info |
| Disconnect: clear agents + show reconnecting state | `daemon.onStateChange → clearAllAgents()` + `setStatus("reconnecting")` |
| `PiStudioClient` in React context | `ClientProvider` wraps children; `useClient()` returns the instance |
| Multi-host | `skipConnection` prop on `AppProviders` for test isolation; `setAddress()` updates KV + triggers reconnect |

## Build & test results

```
$ npx tsc -b packages/app
(no errors)

$ npm test -- packages/app/src/providers/connection-provider.test.ts
Test Files  1 passed (1)
Tests  12 passed (12)

$ npm test
Test Files  104 passed (104)
Tests  1409 passed (1409)
```

## Acceptance criteria
- [x] App connects to daemon on startup — `ConnectionProvider` initiates on mount
- [x] Boot gate state: no-hosts → Welcome; connected → Home — `AppConnectionStatus` enum drives routing
- [x] Reconnect: auto-reconnect via `ReconnectionManager`; reconnect clears agents + refetches
- [x] Multi-host: `setAddress()` updates KV and triggers re-connect to new daemon

## Follow-ups / TODO(verify)
- `skipConnection` default is `false` (connection active by default). Tests using `AppProviders` should pass `skipConnection` to avoid real WS connections.
- `daemon.serverId` availability after connect needs to be confirmed — it is only available after the `hello`/`status` exchange; currently checked on `onStateChange("open")`.
- Full `server_info` (version, features) population needs a `status` message handler.
