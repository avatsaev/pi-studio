# Task 005 — Live check of saved history, and close of M3

- **Sprint:** sprints/sprint-150-timeline-on-disk
- **Status:** backlog
- **Type:** test
- **Area:** packages/server, packages/workbench, docs
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-004

## Goal
Saved history seen working on a real Pi and in the workbench, the gates green, and the docs and the
handoff up to date.

## Context / why
Same throwaway set-up as sprint-149/task-005 (temporary homes, a copy of the Pi credentials, a spare
port). The workbench check uses a browser tab on the dev web client against that daemon (the developer
origin switch of sprint-146/task-001).

## Scope references
- `docs/daemon-audit-handoff.md` § Approved improvements (row 3), § Milestones (M3)
- `swe/architecture/agent-timeline-persistence.md`

## What to build
Run and record:
1. A conversation of several turns; stop the daemon; start it; send a message first: earlier history is
   shown, then the new turn.
2. A workbench tab open across the restart: after reconnecting it shows no missing or duplicated rows.
3. A long conversation (dev daemon with the mock's long turns, or a real one): the daemon's memory stays
   flat; the file size per turn is noted.
4. Delete an agent: its timeline file is gone.
Then: root `AGENTS.md` § Persistence layout (the timeline file), `packages/server/AGENTS.md`; full gates
(`npm run build`, `npm run typecheck`, `npm run lint`, `npm test`); mark M3 done in the handoff and
`PLAN.md`.

## Acceptance criteria
- [ ] All four recorded; gates green.

## Test / verification plan
As above.
