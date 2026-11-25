# Task 004 — Restart, resets and delete with the timeline file

- **Sprint:** sprints/sprint-150-timeline-on-disk
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (agent timeline, session operations, hydration)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-003

## Goal
After a restart the timeline comes back from its file with the same sequence numbers; a reset rewrites
it; a delete removes it.

## Context / why
Second half of the approved design (task-002), and the rest of finding A6.

## Scope references
- `swe/architecture/agent-timeline-persistence.md`
- `packages/server/src/agent/agent-service.ts` (seeding from task-001)
- `packages/server/src/agent/providers/pi/session-hydration.ts`
- `packages/server/src/agent/slash-command-operations.ts` (`handleFork`, `agent_timeline_reset`)
- `packages/server/src/agent/session-operations.ts` (`import_agent_session`, which today writes
  `record.timeline`)
- `packages/server/src/agent/agent-manager.ts` (`deleteAgent`)
- `packages/server/src/persistence/entity-schemas.ts` (`timeline` in the agent record)

## What to build
- First access after a restart loads from the file; hydration from Pi's session file only when the file
  is missing, and the result is written to a new file.
- A reset rewrites the file atomically; delete removes it; archive keeps it.
- Imports write the file instead of `record.timeline`; the daemon stops writing `record.timeline`
  (the schema stays `.passthrough()`, owner decision).

## Acceptance criteria
- [ ] Restart test: rows and sequence numbers identical before and after; a client cursor taken before
      the restart pages correctly after it.
- [ ] Fork test: the file matches the in-memory timeline after the reset.
- [ ] Delete test: the file is gone.

## Test / verification plan
- `npx vitest run packages/server/src/agent`
- `npm run build:server`
