# Task 003 — The timeline store writes to and pages from the file

- **Sprint:** sprints/sprint-150-timeline-on-disk
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (agent timeline)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002

## Goal
Each agent's timeline is appended to its file as it happens, held in memory only as a bounded tail,
and paged without walking every row.

## Context / why
Implements the approved design (task-002) for the normal running path. Restart, reset and delete are
task-004.

## Scope references
- `swe/architecture/agent-timeline-persistence.md` (task-002)
- `packages/server/src/agent/timeline-store.ts`, `agent-service.ts` (`timelinesByAgentId`,
  `appendStreamEvent`), `timeline-rpc.ts`

## What to build
As the design says: append on each persisted event with chunks merged into message rows; the
in-memory tail bound; the sequence index; `page()` that reads only the requested window (from memory
or the file). The module-level map evicts an agent's store on archive and delete. Ephemeral events
(`tool_call` partials, `queue_update`) stay out of the file, as they stay out of the store today.

## Acceptance criteria
- [ ] Paging test with a call counter or a large timeline: fetching one page touches O(page) rows.
- [ ] Memory: after N turns the in-memory rows stay at the bound.
- [ ] The file after a turn holds one row per message, not per chunk.
- [ ] Existing timeline tests pass unchanged in meaning (projection, cursors, epochs).

## Test / verification plan
- `npx vitest run packages/server/src/agent`
- `npm run build:server`
