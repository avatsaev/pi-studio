# Task 005 — Frame routing, ping/pong, rpc_error, bootstrap wiring

- **Sprint:** sprint-004-daemon-bootstrap-security
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-004

## Goal
Wire the full bootstrap: route text/binary frames, implement ping/pong liveness and `rpc_error`,
assemble all subsystems, listen, and provide graceful shutdown.

## Scope references
- `clean-room-scope/architecture/websocket-protocol.md` § Behavior (route frames), § Error Handling, § RPC naming
- `clean-room-scope/architecture/daemon-bootstrap.md` § Behavior (bootstrap), § Shutdown

## What to build
- Frame router: text → parse session union → dispatch to a handler registry → correlated
  response/broadcast; binary → decode → terminal/file router (handlers registered by later sprints).
- `ping`/`pong` liveness over the JSON envelope; an RPC timeout is an operation failure and must NOT
  close the socket. `rpc_error` emitted with the originating `requestId` when a handler throws.
- A handler-registry mechanism so feature sprints can register RPC handlers by message type
  (dotted + legacy flat names).
- `bootstrap()`: resolve home, layout, PID lock, server id, keypair, load config, logger, open stores,
  construct AgentManager (stub acceptable until sprint-005), create HTTP + WS servers, listen on
  `PI_STUDIO_LISTEN` (default `127.0.0.1:6767`), write PID file; return `{ close() }`.
- `close()`: stop new connections, close sessions, flush stores, release PID lock (agent/relay close
  hooks wired in later sprints).

## Out of scope
- Concrete feature handlers (registered in their sprints). Relay + service proxy startup (sprint-013/009).

## Acceptance criteria
- [ ] `ping` yields a `pong` echoing `requestId`; a simulated RPC timeout does not close the socket.
- [ ] A handler that throws produces `rpc_error` correlated by `requestId`.
- [ ] Unknown session message types are ignored or `rpc_error` per handler policy.
- [ ] `bootstrap()` listens on the configured address and writes the PID file; `close()` releases the lock.

## Test / verification plan
- Tests: `npx vitest run .../routing.test.ts`, `.../bootstrap.test.ts` — ping/pong, rpc_error, listen +
  graceful close (PID released).
- Manual: start the daemon, `curl localhost:6767/api/health` → success; stop → lock released.

## Notes
- Critical operational rule: restarting the production daemon kills all agents; never restart without
  explicit user intent. Use a separate dev home/port for tests.
