# Task 002 — Provider layer: Pi event mapping, session hydration, mock compaction — Summary

- **Sprint:** sprints/sprint-074-context-compaction
- **Completed:** 2026-10-09
- **Status:** done

## What was implemented
- `event-mapper.ts`: `compaction_start`/`compaction_end` → `compaction` events; one `randomUUID()` per compaction held as the mapper's open id; aborted→canceled, result→completed, else failed; stray end mints a fresh id.
- `session-hydration.ts`: Pi `compaction` entries replayed as a lone `completed` row (`compactionId = entry.id`).
- Mock provider: `compact()` emits started → (delay, `compactDelayMs`, default 1.5 s) → completed, returns `estimatedTokensAfter`.
- `AgentCompactResult.estimatedTokensAfter` added to the provider contract.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/providers/pi/event-mapper.ts` | modified |
| `packages/server/src/agent/providers/pi/session-hydration.ts` | modified |
| `packages/server/src/agent/providers/mock/mock-provider.ts` | modified |
| `packages/server/src/agent/provider-contract.ts` | modified |
| `…/pi/pi-adapter.test.ts`, `…/pi/session-hydration.test.ts`, `…/mock/mock-provider.test.ts` | tests |
| `packages/server/AGENTS.md` | documented |

## Build & test results
```
$ npx vitest run packages/server/src/agent/providers  -> 6 files, 141 passed
$ npm run build:server; npm run typecheck             -> success
$ npx oxfmt (changed); npx oxlint packages/server/src/agent -> clean
```

## Acceptance criteria
- [x] start → end(result): same id, all fields  - [x] aborted/failed/orphan end  - [x] distinct ids
- [x] hydration row at entry position, others unchanged  - [x] mock started → completed with estimate

## Follow-ups / TODO(verify)
- Recording/broadcasting outside a turn is task-003.
