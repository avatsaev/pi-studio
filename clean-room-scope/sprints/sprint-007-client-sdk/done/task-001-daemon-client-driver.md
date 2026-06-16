# Task 001 — DaemonClient low-level WS driver

- **Sprint:** sprint-007-client-sdk
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-005 (sprint-002, all protocol schemas/codecs)

## Goal
Implement the low-level `DaemonClient` WebSocket driver: connect, hello handshake, framing, RPC
correlation, and a pluggable transport abstraction.

## Scope references
- `clean-room-scope/architecture/client-app-runtime.md` § Layered client library, § Connection
- `clean-room-scope/architecture/websocket-protocol.md` § Connection & handshake, § Top-level envelopes

## What to build
- `packages/client/src/daemon-client.ts`: `connect()` opens the socket, sends `hello` (clientId,
  clientType, protocolVersion, capabilities), awaits `status`/`server_info`, records `serverId` +
  `features`.
- Frame send/receive: text session envelopes + binary frames; correlate request/response by
  `requestId`; surface `rpc_error` as a rejected RPC (NOT a socket death).
- `ping`/`pong` liveness; RPC timeout = operation error only.
- A `Transport` abstraction so direct-WS and (later) relay transports share one API.
- `ConnectionState` model.

## Out of scope
- `Pi-StudioClient` facade/handles (task-002). Relay transport implementation (sprint-013).
  Terminal router (task-003).

## Acceptance criteria
- [ ] `connect()` completes the hello handshake and records `serverId`+`features`.
- [ ] An RPC resolves on its correlated response and rejects on `rpc_error` (same `requestId`).
- [ ] An RPC timeout produces an operation error without tearing down the socket.
- [ ] `ConnectionState` reflects connecting/open/closed transitions.

## Test / verification plan
- Tests: `npx vitest run packages/client/.../daemon-client.test.ts` against an in-memory daemon WS
  (or the sprint-004 server) — handshake, correlation, rpc_error reject, timeout-not-death.

## Notes
- The transport abstraction must keep direct and relay paths symmetric.
