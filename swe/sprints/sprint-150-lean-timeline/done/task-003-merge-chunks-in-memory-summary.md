# Task 003 — One timeline row per message instead of one per chunk — Summary

- **Sprint:** sprints/sprint-150-lean-timeline
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`AgentTimelineStore.append` merges consecutive `assistant_message` / `reasoning` chunks of the same kind, epoch and `messageId` into the last row (a `final: true` chunk seals it); the merged text goes into a new event object, so an event already broadcast is never mutated. Every chunk still takes its own `seq` (live frames unchanged: `append` returns the event's own `{epoch, seq, timestamp}`); a row carries `seq` (first) and `seqEnd` (last). `after c` returns rows with `seqEnd > c`, `before c` rows with `seq < c`; a row straddling the cursor comes back whole; a page's `seqStart`/`seqEnd` are the lowest `seq` and highest `seqEnd`, so the workbench's `fetchedThrough` rule holds. A fetch while a message streams returns the text so far. `timeline-rpc.ts` rejects a direction other than `before` or `after` (absent still means `after`); the CLI `agent logs` sends `before` instead of `backward`. Hydration rows carry `seqEnd === seq`.

## Files changed
`packages/server/src/agent/{timeline-store,timeline-rpc}.ts`, `providers/pi/session-hydration.ts`, `packages/cli/src/agent-commands.ts` (+test), `packages/server/AGENTS.md`; tests: new `timeline-store-equivalence.test.ts` (keeps the old per-chunk store as a reference: 300 seeded random scripts, 40 random pages each, written and checked against the unchanged store first), new cases in `timeline-store.test.ts` and `timeline-rpc.test.ts`; `seqEnd` added to row literals in four existing tests.

## Measured (replayed 300-chunk message, 200 stores, heap after gc)
| | Before | After |
|---|---|---|
| Rows | 304 | 4 |
| Heap per store, while streaming | 39.5 KB | 17.7 KB (the merged text is a rope of 300 pieces until a fetch flattens it) |
| Heap per store, after a fetch | 39.5 KB | 3.0 KB |
| Page JSON | 14,099 B | 2,409 B |

## Build & test results
```
$ npx vitest run packages/server packages/protocol packages/client packages/cli packages/workbench/src/hooks -> 178 files, 2,655 passed (includes the external-fixtures e2e)
$ npm run build:server && npm run build:cli -> success
Full tree: build, typecheck, lint 0 errors; npm test all passed (two runs); oxfmt clean on changed files
```

## Acceptance criteria
- [x] Equivalence test (items, seqStart/seqEnd, sourceSeqRanges, collapsed, hasNewer, both cursors) against the reference; the two allowed differences are the merged `events` and mid-row cursors, which the reference receives snapped to the row boundary
- [x] 300 chunks make one row; interleaved tool calls and a reasoning-to-answer kind change start a new row
- [x] A cursor in the middle of a merged row pages forward and backward without loss or repeat
- [x] All existing timeline tests keep their meaning

## Follow-ups / TODO(verify)
- One deliberate wire difference: an assistant item's `events` is now one merged event per row instead of one per chunk, so `agent logs --json` has a new shape (fewer, longer events). The workbench replays them to the same row text.
