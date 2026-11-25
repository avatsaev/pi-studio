# Task 003 — One slow client cannot grow the daemon's memory

- **Sprint:** sprints/sprint-154-socket-limits
- **Status:** done
- **Type:** bugfix
- **Area:** packages/server (ws session, broadcast, terminal output)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002

## Goal
A broadcast is serialised once, and a client that does not read is cut off instead of filling memory.

## Context / why
Finding T2 and F4 (second bullet). `Session.send` stringifies per recipient, so a broadcast to N
sessions costs N serialisations. Nothing looks at the send queue on a broadcast, a per-session push or
a terminal flush, so a client that stops reading grows the queue without bound.

## Scope references
- `docs/daemon-audit-handoff.md` § "M5 choices" (sockets), § T2, § F4
- `packages/server/src/ws/session.ts` (`send` near :80, `bufferedAmount` :93-97),
  `daemon/bootstrap.ts` (`broadcast` :323-331), `dev-bootstrap.ts`
- `packages/server/src/terminal/terminal-manager.ts` (`flush` :360-367)
- `packages/server/src/files/file-transfer.ts` (download pacing on `bufferedAmount`, :518, :540)
- `packages/server/src/daemon/relay-sessions.ts` (`socketFacade.bufferedAmount`)

## What to build
- A broadcast serialises the envelope once and sends the same text to every session.
- Before a send, a session whose queue is above `MAX_SEND_QUEUE_BYTES` (16 MiB) is closed with 1013
  ("send queue full") and terminated, with a warn log naming the client. This covers broadcasts,
  per-session pushes and terminal output, on direct and relay sessions.
- Downloads keep their own pacing and never trip the cap (their high-water mark is 1 MiB).
- The SDK reconnects after a 1013 close and the workbench resyncs: confirm with a test; if the SDK
  treats 1013 as final, pick another close code instead of changing the SDK.

## Out of scope
Pausing a terminal's process when its viewer is slow.

## Acceptance criteria
- [ ] A client that stops reading while 100 MiB of events are broadcast is closed with 1013; the
      daemon's queue for it is released; a second client received every event in order.
- [ ] One broadcast calls the serialiser once whatever the number of sessions.
- [ ] A download to a slow client still completes.
- [ ] `DaemonClient` reconnects after the 1013 close.

## Test / verification plan
- `npx vitest run packages/server packages/client`
- `npm run build:server`
