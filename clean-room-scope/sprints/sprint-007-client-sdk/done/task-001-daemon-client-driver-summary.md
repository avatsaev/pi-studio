# Task 001 — DaemonClient low-level WS driver — Summary

- **Sprint:** sprint-007-client-sdk
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
- `packages/client/src/transport.ts` — `Transport` abstraction (symmetric API for direct-WS and
  future relay). `createWebSocketTransport(factory?)` wraps a browser/RN/Node `WebSocket`, surfacing
  `onMessage` / `onClose` / `onError` and `sendText` / `sendBinary` / `close` / `isOpen`. Node `ws`
  Buffer/close-reason quirks normalized.
- `packages/client/src/daemon-client.ts` — `DaemonClient` driver:
  - `connect()` opens the socket, sends `hello` (clientId, clientType, protocolVersion, capabilities),
    awaits `status`/`server_info`, records `serverId`, `features`, `serverCapabilities`.
  - `request(type, params, timeoutMs?)` — correlated RPC by `requestId`; resolves on the matching
    response `payload`; rejects with `RpcError` on a correlated `rpc_error`; rejects with
    `RpcTimeoutError` on timeout **without** tearing down the socket.
  - `sendSession` / `sendBinary` for fire-and-forget; `ping()` JSON liveness over the data path.
  - Inbound routing: `status` → handshake; `pong` → resolve; `ping` → auto-pong; `session` →
    correlate + fan out; binary → decode terminal frame + dispatch.
  - `ConnectionState` (`idle`→`connecting`→`open`→`closing`→`closed`) with `onStateChange`. Socket
    drop rejects all pending RPCs (distinct from a per-RPC timeout).
  - Subscriptions: `onSessionMessage`, `onTerminalFrame`, `onStateChange`. `hasFeature(flag)`.
- `packages/client/src/index.ts` — exports transport + daemon-client.

## Files created / changed
| File | Change |
|------|--------|
| `packages/client/src/transport.ts` | created |
| `packages/client/src/daemon-client.ts` | created |
| `packages/client/src/index.ts` | modified |
| `packages/client/src/daemon-client.test.ts` | added — 8 tests |

## Commands & results
- `npm run build:client` → exit 0 (no type errors)
- `npx vitest run packages/client/src/daemon-client.test.ts` → **8 passed**
- `npx oxlint packages/client` → clean
- `npx oxfmt --check packages/client` → clean

## Acceptance criteria
- [x] `connect()` completes the hello handshake and records `serverId`+`features`.
- [x] An RPC resolves on its correlated response and rejects on `rpc_error` (same `requestId`).
- [x] An RPC timeout produces an operation error (`RpcTimeoutError`) without tearing down the socket.
- [x] `ConnectionState` reflects connecting/open/closed transitions.

## Notes / TODO(verify) carried forward
- Reconnection backoff parameters (task-003).
- Desktop `clientType` uses `browser` (per websocket-protocol.md TODO).
