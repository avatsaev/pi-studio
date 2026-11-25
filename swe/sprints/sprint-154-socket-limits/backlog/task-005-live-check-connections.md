# Task 005 — Live check of connections

- **Sprint:** sprints/sprint-154-socket-limits
- **Status:** backlog
- **Type:** test
- **Area:** packages/server, desktop, docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-004

## Goal
The four limits seen working against real clients, and no real client broken by them.

## Context / why
The handoff's warning on improvement 6: a user on a very poor connection now sees a reconnect where
today they see a long freeze. Run on a throwaway daemon; never the owner's.

## Scope references
- `docs/daemon-audit-handoff.md` § Approved improvements (row 6)

## What to build
Run and record:
1. A client process frozen with SIGSTOP disappears from `pi-studio daemon status` within about a
   minute.
2. The same frozen client while an agent streams and a terminal prints without end: the daemon's
   memory stays flat, that client is cut, a second client is unaffected.
3. A bare TCP connection that sends nothing is closed after 10 s; an oversize frame is refused.
4. The workbench in a real browser after a forced 1013 close: it reconnects and the conversation is
   whole.
5. The desktop app's connections live through several ping intervals (the proxy's daemon socket and
   the transfer connection), and one relay client still works.
Docs: `packages/server/AGENTS.md`, root `AGENTS.md` § Protocol overview (the liveness sentence),
`swe/architecture/websocket-protocol.md`. Full gates, and `cd desktop && cargo xtask ci`.

## Acceptance criteria
- [ ] All five recorded, with what could not be checked named; gates green.

## Test / verification plan
As above.
