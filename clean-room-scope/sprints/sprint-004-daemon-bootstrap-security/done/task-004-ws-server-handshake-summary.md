# Task 004 — WebSocket server: handshake, sessions, capability rehydrate — Summary

- **Sprint:** sprint-004-daemon-bootstrap-security
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
- `packages/server/src/ws/session.ts` — `Session` (id, clientId, clientType, capabilities, socket)
  with `supports(flag)` (protocol gating helper), `send(envelope)`, `sendBinary`, `close`.
- `packages/server/src/ws/capability-store.ts` — `CapabilityStore` interface + in-memory default,
  keyed by `clientId`.
- `packages/server/src/ws/ws-server.ts` — `createWebSocketServer(httpServer, deps)` (using `ws` with
  `noServer:true`):
  - On `upgrade`: Host-allowlist + `auth.authenticateUpgrade` checks; rejects with raw `403`/`401`
    before completing the handshake; selects the `pi-studio.bearer.*` subprotocol when offered.
  - On connection: the **first frame must be a valid `hello`** (else `close(1008)`); registers a
    `Session`, persists `hello.capabilities` keyed by `clientId` (rehydrates stored caps when the
    hello omits them), and emits `status`/`server_info` (`serverId`, `capabilities`, `features` —
    defaulting to all `SERVER_FEATURES` enabled), validated through `statusSchema`.
  - Post-handshake frames are forwarded to `onMessage` (router wired in task-005).
  - `close()` closes all sessions and the server.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/ws/session.ts` | created |
| `packages/server/src/ws/capability-store.ts` | created |
| `packages/server/src/ws/ws-server.ts` | created |
| `packages/server/src/ws/index.ts` | created (barrel) |
| `packages/server/src/index.ts` | modified — re-exports ws |
| `packages/server/src/ws/ws-server.test.ts` | added — 4 tests |
| `packages/server/package.json` | `ws` dependency (+ `@types/ws`) |

## How it satisfies the scope
- **websocket-protocol.md § Connection & handshake / § Behavior:** hello → `status`/`server_info`
  (no separate welcome), capability persist-on-hello + rehydrate-on-reconnect, `session.supports`.
- **MAIN-SCOPE §4 (websocket-server, session):** per-client session registration over the HTTP
  server; auth + host checks applied at upgrade.

## Build & test results
```
$ npm run build:server          → exit 0 (no type errors)
$ npx vitest run packages/server/src/ws/ws-server.test.ts
 ✓ ws-server.test.ts (4 tests)
 Test Files  1 passed (1)      Tests  4 passed (4)
$ npx oxlint packages/server   → clean
```

## Acceptance criteria
- [x] A client that sends `hello` receives `status`/`server_info` with `serverId` and `features`.
- [x] A first frame that is not `hello` is rejected/closed (`close` code 1008).
- [x] Capabilities are persisted on hello and rehydrated on reconnect (`session.supports` reflects
      them on a second connection with the same `clientId` and no capabilities in the hello).

## Follow-ups / TODO(verify)
- Desktop connects as `clientType:"browser"` (TODO(verify)); all four client types are accepted.
- Capability store is in-memory for the daemon lifetime; a persistent backing store can be swapped
  in via the `CapabilityStore` interface if required.
- Frame routing / ping-pong / rpc_error wiring is task-005.
