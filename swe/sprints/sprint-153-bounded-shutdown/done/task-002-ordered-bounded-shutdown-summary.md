# Task 002 — An ordered, bounded shutdown that always removes the PID file — Summary

- **Sprint:** sprints/sprint-153-bounded-shutdown
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`daemon/shutdown.ts`: `runShutdown(steps, logger)` and `SHUTDOWN_DEADLINE_MS = 10_000`. A step that throws is logged with its name and the next runs; a step pending at the deadline is logged as abandoned and later steps are skipped, except `always` steps (the PID file). Production order: stop accepting, agents, terminals, file watch, status, logs, relay, sockets, HTTP, PID file; the dev daemon the same without file watch, relay and PID. Stop accepting: new upgrades get 503, relay dials are ignored, every later request gets `rpc_error` `shutting_down` (a `ping` is still answered; a running request finishes), update timers stop. Sockets close with 1001 and are terminated after `SOCKET_CLOSE_GRACE_MS` (1 s); HTTP closes all connections instead of waiting.

## Files changed
`daemon/shutdown.ts` (+test, 15 tests), `bootstrap.ts`, `dev-bootstrap.ts`, `relay-transport.ts`, `ws/ws-server.ts`, `ws/router.ts`, `http/http-server.ts` and their tests; docs: `packages/server/AGENTS.md` (new "Daemon shutdown" section), `README.md`, `swe/architecture/websocket-protocol.md`, `external-client-fixtures.md`.

## Build & test results
```
npx vitest run packages/server/src/{daemon,ws,http} -> 21 files, 297 passed; build:server OK
Wave gate (full tree): build, typecheck 0 errors; lint 0 errors; npm test 331 files, 4750 tests passed
```

## Acceptance criteria
- [x] A step that throws: later steps run, PID file gone, `close()` resolves
- [x] A step that never returns: resolves at the deadline (fake timers), PID file gone
- [x] `create_agent_request` after shutdown began: `shutting_down`, no agent (both daemons)
- [x] A client that never answers the close frame delays the close by the 1 s grace only
- [x] Order asserted for production and dev

## Follow-ups / TODO(verify)
- Binary frames (terminal input, upload chunks) are not refused after shutdown began; uploads are ended in sprint-153/task-004.
- No relay-level test of `shutting_down` (the registry is shared by direct and relay sessions).
- Stale protocol text: a comment in `packages/protocol/src/messages.ts` (~:1110) and the `rpc_error.json` fixture description say the router only emits `unknown_message_type` / `handler_error`. `code` is a free string; fixed with sprint-151/task-004.
- `relay-transport.test.ts:207` has a type error (`onBinary` missing in `ChannelEvents`) that was already there; tests are outside `tsc -b`.
