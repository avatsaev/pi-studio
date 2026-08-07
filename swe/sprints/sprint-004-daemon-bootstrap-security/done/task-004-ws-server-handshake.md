# Task 004 — WebSocket server: handshake, sessions, capability rehydrate

- **Sprint:** sprint-004-daemon-bootstrap-security
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-003; task-001 (sprint-002), task-002 (sprint-002)

## Goal
Implement the WebSocket server that performs the hello handshake, emits `server_info`, registers
per-client sessions, and persists/rehydrates client capabilities.

## Scope references
- `clean-room-scope/architecture/websocket-protocol.md` § Connection & handshake, § Behavior (on connection / on reconnect)
- `clean-room-scope/MAIN-SCOPE.md` § 4 (websocket-server, session)

## What to build
- `createWebSocketServer(httpServer, { agentMgr, sessionFactory, auth, hostCheck })`.
- On connection: validate Host + auth; expect first frame `hello`; register a `Session`; persist
  client capabilities keyed by `clientId`; emit `status`/`server_info` (serverId, capabilities,
  features); begin streaming.
- On reconnect: rehydrate stored capabilities for `clientId`.
- `session.supports(flag)` reads stored capabilities (from sprint-002 helper).
- Reject when the first frame is not `hello`.

## Out of scope
- Frame routing/dispatch + ping/pong + rpc_error wiring (task-005). Agent logic (sprint-005/006).

## Acceptance criteria
- [ ] A client that sends `hello` receives `status`/`server_info` with `serverId` and `features`.
- [ ] A first frame that is not `hello` is rejected/closed.
- [ ] Capabilities are persisted on hello and rehydrated on reconnect (`session.supports` reflects them).

## Test / verification plan
- Tests: `npx vitest run .../ws-handshake.test.ts` — handshake, server_info contents, non-hello reject,
  reconnect rehydrate (use an in-memory ws pair).

## Notes
- Desktop uses `clientType:"browser"` (TODO(verify)). Session capabilities make the wire boundary ask
  one question: `session.supports(...)`.
