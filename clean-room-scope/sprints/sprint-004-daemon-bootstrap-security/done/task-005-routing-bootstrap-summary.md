# Task 005 — Frame routing, ping/pong, rpc_error, bootstrap wiring — Summary

- **Sprint:** sprint-004-daemon-bootstrap-security
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
- `packages/server/src/ws/router.ts`:
  - `HandlerRegistry` — `register(type, handler)`, `registerAlias(legacyFlat, canonicalDotted)`,
    `get(type)` (direct then alias) so dotted + legacy flat names both resolve.
  - `routeTextFrame(session, text, registry)` — parses the top-level envelope: `ping` → `pong`
    (echoing `requestId`, `serverReceivedAt`/`serverSentAt`, validated via `pongSchema`); `pong`
    ignored; `session` → dispatch by message `type`. Handler results are wrapped in a `session`
    envelope and correlated by `requestId`; a throwing/timed-out handler emits a correlated
    `rpc_error` and **never closes the socket**; unknown types `rpc_error` only when they carry a
    `requestId`, else are ignored.
  - `routeBinaryFrame(session, bytes, binaryHandler?)` — pass-through hook for terminal/file routers.
- `packages/server/src/daemon/bootstrap.ts` — `bootstrap({ env })`: resolve home + layout, load
  config, acquire PID lock (writes `pi-studio.pid`), server id, keypair, build auth + host checker, create
  HTTP + WS servers wired to the router, listen on `PI_STUDIO_LISTEN`/`config.daemon.listen` (default
  `127.0.0.1:6767`), and return `{ home, serverId, host, port, httpServer, ws, registry, pidLock,
  close() }`. `close()` stops connections, closes sessions, closes the HTTP server, and releases the
  PID lock. AgentManager is a `recover()` stub (real one lands in sprint-005).

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/ws/router.ts` | created |
| `packages/server/src/ws/index.ts` | modified — re-exports router |
| `packages/server/src/daemon/bootstrap.ts` | created |
| `packages/server/src/daemon/index.ts` | modified — re-exports bootstrap |
| `packages/server/src/ws/router.test.ts` | added — 6 tests |
| `packages/server/src/daemon/bootstrap.test.ts` | added — 4 tests |

## How it satisfies the scope
- **websocket-protocol.md § Behavior / § Error Handling / § RPC naming:** ping/pong over the JSON
  envelope (not RFC6455 ping), RPC timeout ≠ dead socket, `rpc_error` correlated by `requestId`,
  dotted + legacy flat name resolution, unknown-type handler policy.
- **daemon-bootstrap.md § Behavior / § Shutdown:** the documented bootstrap step order and the
  graceful `close()` sequence (stop connections → close sessions → flush/close → release PID lock).

## Build & test results
```
$ npm run build:server          → exit 0 (no type errors)
$ npx vitest run packages/server/src/ws/router.test.ts packages/server/src/daemon/bootstrap.test.ts
 ✓ router.test.ts (6) ✓ bootstrap.test.ts (4)   → 10 passed

# Full sprint re-verification
$ npm run build                 → exit 0
$ npx vitest run                → 19 files, 140 tests passed
$ npx oxlint                    → clean
$ npx oxfmt --check .           → clean
```
Manual equivalent of `curl localhost:6767/api/health` is covered by `bootstrap.test.ts` (health → 200)
and lock release on `close()`.

## Acceptance criteria
- [x] `ping` yields a `pong` echoing `requestId`; a simulated RPC timeout does not close the socket.
- [x] A handler that throws produces `rpc_error` correlated by `requestId` (socket stays open).
- [x] Unknown session message types are ignored (no `requestId`) or `rpc_error` (with `requestId`).
- [x] `bootstrap()` listens on the configured address and writes the PID file; `close()` releases the lock.

## Follow-ups / TODO(verify)
- Logger is a no-op placeholder (pino wiring deferred); `agentMgr` is a `recover()` stub until
  sprint-005. Relay + service-proxy startup are sprints 013/009.
- Operational rule noted: restarting the production daemon kills all agents — tests use an isolated
  temp `PI_STUDIO_HOME` and an ephemeral port (`127.0.0.1:0`), never the production `6767`.
