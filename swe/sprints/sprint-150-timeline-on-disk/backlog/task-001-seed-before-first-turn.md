# Task 001 — After a restart, history is loaded before the first turn

- **Sprint:** sprints/sprint-150-timeline-on-disk
- **Status:** backlog
- **Type:** bugfix
- **Area:** packages/server (agent service)
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** sprint-149/task-004

## Goal
If the first thing after a daemon restart is a new message, the conversation's earlier history is
still there.

## Context / why
Finding A6, the small part, done first on purpose. `runTurn` calls `getOrCreateTimeline` and never
`ensureTimelineSeeded`; seeding happens only in the timeline fetch and in compact. A send before any
fetch creates an empty store, and seeding is a no-op from then on. Depends on sprint-149/task-004
(`agent-service.ts`).

## Scope references
- `docs/daemon-audit-handoff.md` § A6, § Approved improvements (row 3)
- `packages/server/src/agent/agent-service.ts` (`getOrCreateTimeline`, `ensureTimelineSeeded`,
  `appendStreamEvent`, `runTurn`)
- `packages/server/src/agent/providers/pi/session-hydration.ts`

## What to build
Every path that appends to an agent's timeline seeds it first. One choke point (inside
`getOrCreateTimeline`, or a single `timelineFor(agentId)` the appenders use), not a call per site.

## Acceptance criteria
- [ ] Regression test: a recovered agent with a Pi session file, first action `send_agent_prompt`, then
      `fetch_agent_timeline_request` → old rows, then the new turn.

## Test / verification plan
- `npx vitest run packages/server/src/agent`
