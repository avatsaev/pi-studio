# Task 002 — An ordered, bounded shutdown that always removes the PID file

- **Sprint:** sprints/sprint-153-bounded-shutdown
- **Status:** done
- **Type:** bugfix
- **Area:** packages/server (daemon bootstrap, ws server, HTTP)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** none

## Goal
Stopping the daemon finishes within a fixed time on every path, in an order that makes sense, and
leaves no PID file behind.

## Context / why
Finding T1 as re-read on 2026-11-25. `closeDaemon` has eleven steps and no try/finally: a step that
throws skips the rest, including the PID file. Nothing bounds the whole. Agents are closed while the
socket server still accepts requests such as `create_agent_request`. `wss.close` waits for every
client, so a half-open one can hold it for about 30 s, and `httpServer.close` waits for keep-alive
connections. The dev daemon has its own shorter copy.

## Scope references
- `docs/daemon-audit-handoff.md` § "M5 choices" (shutdown order), § T1
- `packages/server/src/daemon/bootstrap.ts` (`closeDaemon` :951-966, `removePidLock`),
  `dev-bootstrap.ts` (:529-541)
- `packages/server/src/ws/ws-server.ts` (`close` near :210), `ws/router.ts`, `http/http-server.ts`,
  `daemon/relay-transport.ts` (:272-280)
- `packages/server/src/daemon/shutdown.test.ts`, `packages/server/AGENTS.md`

## What to build
- `daemon/shutdown.ts`: a small runner. Steps run in order; a step that throws or overruns is logged
  with its name and the next one runs; the whole is bounded by an exported
  `SHUTDOWN_DEADLINE_MS = 10_000`; steps marked "always" (the PID file) run even after the deadline.
  Both bootstraps list their steps through it.
- **Order:** stop accepting; agents (`closeAll`, 7 s); terminals; file watch, status and log
  services; relay; sockets; HTTP; PID file.
- **Stop accepting:** the socket server refuses new upgrades (503), the relay stops taking dials, and a
  request that arrives after shutdown began gets `rpc_error` with code `shutting_down` (a `ping` is
  still answered).
- **Sockets:** sessions are closed with 1001; any still open after 1 s are terminated. HTTP closes its
  idle and active connections instead of waiting for them.

## Out of scope
Signals and process-level errors (task-003). Child processes, uploads and login flows (task-004).

## Acceptance criteria
- [ ] A step that throws: the later steps run, the PID file is gone, `close()` resolves.
- [ ] A step that never returns: `close()` resolves by the deadline (fake timers), the PID file is gone.
- [ ] `create_agent_request` sent after shutdown began: `shutting_down`, and no agent exists.
- [ ] A client that never answers the close frame delays the close by no more than the 1 s grace.
- [ ] The order is asserted by a test, for the production and the dev daemon.

## Test / verification plan
- `npx vitest run packages/server/src/daemon packages/server/src/ws packages/server/src/http`
- `npm run build:server`

## Notes
Sprint 151 runs beside this one and uses `ctx.afterReply` in the router: keep that hook as it is.
