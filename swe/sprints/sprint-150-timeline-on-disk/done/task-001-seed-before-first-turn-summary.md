# Task 001 — After a restart, history is loaded before the first turn — Summary

- **Sprint:** sprints/sprint-150-timeline-on-disk
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`timelineFor({manager, resolveClient, now?}, agentId)` in `agent-service.ts` seeds the timeline (`ensureTimelineSeeded`) and then gets or creates the store; it is the only way to obtain a store to append to. `runTurn` and `handleCompact` use it (compact's separate seeding call is gone); `appendStreamEvent` takes the store as an argument, so an unseeded append cannot happen by accident. `ensureTimelineSeeded`/`seedTimeline` take an optional `now`, so a seeded store keeps the service's injected clock.

## Files changed
`packages/server/src/agent/agent-service.ts`, `slash-command-operations.ts`, new `seed-before-first-turn.test.ts`, `packages/server/AGENTS.md`.

## Build & test results
```
$ npx vitest run packages/server/src/agent/seed-before-first-turn.test.ts   -> failed before the fix (only the new rows came back), passes after
$ npx vitest run packages/server/src/agent   -> 40 files, 583 passed
$ npm run build:server                        -> success
Full tree: build, typecheck, lint 0 errors; npm test all passed; oxfmt clean
```

## Acceptance criteria
- [x] A recovered agent with a Pi session file, first action `send_agent_prompt`, then `fetch_agent_timeline_request`: old rows, then the new turn (hydration called once)

## Follow-ups / TODO(verify)
- None.
