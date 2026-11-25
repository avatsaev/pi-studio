# Task 003 — One slow client cannot grow the daemon's memory — Summary

- **Sprint:** sprints/sprint-154-socket-limits
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`ws/limits.ts` gains `MAX_SEND_QUEUE_BYTES` (16 MiB). `Session.send`, `sendText` and `sendBinary` check the socket's queue first, so one check covers broadcasts, per-session pushes, terminal output, downloads and relay sessions; over the cap the session calls `close(1013, "send queue full")` then `terminate()`, logs a warn naming the client, and sends nothing more. `broadcast` is now one exported function in `daemon/bootstrap.ts` that serialises the envelope once (the dev daemon imports it instead of keeping a copy). `RelayConnection` gained `terminate()` and the relay socket facade forwards to it. Downloads pace themselves at 1 MiB and never reach the cap. On a real cut-off `terminate()` discards the queued close frame, so the client sees 1006; the SDK's `ReconnectionManager` reconnects on any close code and the workbench resyncs when the connection opens again, so no client change was needed.

## Files changed
`ws/{session,limits,ws-server}.ts`, `daemon/{bootstrap,dev-bootstrap,relay-sessions,relay-connection}.ts`; new tests `ws/session.test.ts`, `daemon/broadcast.test.ts`, `daemon/slow-clients-e2e.test.ts`, `packages/cli/src/slow-client-reconnect-sdk-e2e.test.ts`; `relay-sessions.test.ts`, `relay-connection.test.ts`; docs `packages/server/AGENTS.md` (invariant 9 "Slow clients"), `README.md`.

## Build & test results
```
npx vitest run packages/server packages/client packages/cli -> 161 files, 2409 passed; five clean repeat runs of the new e2e tests; build:server OK; oxfmt/oxlint clean
```

## Acceptance criteria
- [x] A client that stops reading during a 100 MiB broadcast is closed, its queue released, a second client got every event in order (real sockets)
- [x] One broadcast calls the serialiser once whatever the number of sessions
- [x] A 40 MiB download to a paused-then-resumed reader completes, the queue stays below the cap
- [x] `DaemonClient` reconnects after a 1013 close and after the real cut-off

## Follow-ups / TODO(verify)
- The 1013 code never reaches a client that is truly stalled (the unit tests check the close and terminate calls).
- Terminal output over the cap is covered only through `Session.sendBinary`; no terminal-specific test.
