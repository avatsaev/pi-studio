# Task 004 — Evict an agent's history on archive and delete; drop the dead `record.timeline` — Summary

- **Sprint:** sprints/sprint-150-lean-timeline
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
A new `TimelineRegistry` (`agent/timeline-registry.ts`), held by `AgentManager` as `manager.timelines`, replaces the module-level map and `getTimeline`/`seedTimeline`/`resetTimeline` (the session-operations and slash-command services have no `AgentService`, and the manager is already in every one of their deps). API: `get`, `getOrCreate`, `seed` (no-op if a store exists), `reset`, `evict`, `size`. `archiveAgent` evicts after `session.close()` and before it notifies subscribers (child cascades go through the recursion); `deleteAgent` evicts where the agent leaves memory. `timelineFor` throws for an agent that is gone or archived, so a late event cannot recreate a store; a turn still ending keeps appending to the store object it captured. `handleFork` skips the reset for an archived agent. A fetch for an archived agent still seeds from Pi's file. `record.timeline` is gone from `agentRecordSchema` (still `.passthrough()`), from the `create_agent` and import writes, from `ImportSessionResult.timeline` and from the mock and Pi `importSession`.

## Files changed
New `timeline-registry.ts`, `timeline-registry.test.ts` (the old `agent-service.test.ts`, ported), `timeline-eviction.test.ts`; modified `agent-manager.ts`, `agent-service.ts`, `session-operations.ts`, `slash-command-operations.ts`, `timeline-rpc.ts`, `provider-contract.ts`, `providers/mock/mock-provider.ts`, `providers/pi/agent.ts`, `persistence/entity-schemas.ts`; about 16 existing tests ported to `manager.timelines`; `packages/server/AGENTS.md`.

## Build & test results
```
$ npx vitest run packages/server/src/agent packages/server/src/persistence packages/server/src/daemon -> 61 files, 853 passed
$ npm run build:server -> success
Full tree: build, typecheck, lint 0 errors; npm test 330 files, 4714 tests passed; oxfmt clean on changed files
```

## Acceptance criteria
- [x] After archive and after delete the registry holds no store (`manager.timelines.size` is 0, child cascades included)
- [x] A fetch for an archived agent returns its history (the rebuilt page equals the page fetched before the archive)
- [x] Deleting (or archiving) an agent mid-turn does not recreate its store (the refusal in `timelineFor` has its own test)
- [x] A record containing `"timeline": []` loads; a new record has no `timeline` key

## Follow-ups / TODO(verify)
- A fetch for an archived agent caches its rebuilt store again until the agent is deleted or the daemon restarts. If that matters for memory, add a fetch-only path that does not cache.
- Idle eviction was left out on purpose (a rebuild renumbers rows and an open tab would drop live events numbered below what it has fetched).
