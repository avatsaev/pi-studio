# Task 001 — Append-only timeline store — Summary

- **Sprint:** sprint-006-agent-sessions-timeline
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/agent/timeline-store.ts` — `AgentTimelineStore` with:
- `startEpoch()` — increments epoch (called at the start of each run).
- `append(event)` — assigns a monotonic `seq` + daemon-owned `timestamp`; returns the committed row.
- `allRows()` / `rowCount()` — accessors.
- `page({ direction, cursor?, limit? })` — returns a `TimelinePage` (≤ `DEFAULT_PAGE_SIZE` projected
  items) with `seqStart`, `seqEnd`, `sourceSeqRanges`, `collapsed`, `hasNewer`, `startCursor`/
  `endCursor`. Cursors are base-10 seq strings.
- `projectRows(rows)` — collapses tool-call rows sharing a `callId` into ONE `ToolCallItem` and
  merges adjacent assistant/reasoning chunks into ONE `AssistantItem`; other events are `OtherItem`.

## Files created / changed
| File | Change |
|------|--------|
| `agent/timeline-store.ts` | created |
| `agent/index.ts` | modified — re-exports timeline-store |
| `agent/timeline-store.test.ts` | added — 9 tests |

## How it satisfies the scope
- **timeline-streaming.md § Timeline model / § Behavior:** epochs, monotonic seqs, daemon-owned
  timestamps, projected collapsing, paged reads with all response fields.

## Build & test results
```
$ npm run build:server      → exit 0
$ npx vitest run packages/server/src/agent/timeline-store.test.ts
 ✓ timeline-store.test.ts (9 tests)
```

## Acceptance criteria
- [x] Rows get monotonic sequences; a new run increments the epoch.
- [x] A tool-call spanning many source sequences is exactly one projected item.
- [x] A page returns ≤ limit projected items with all paging fields populated.
- [x] `hasNewer` is true while more rows exist after the page.
- [x] Row timestamps are daemon-owned.
