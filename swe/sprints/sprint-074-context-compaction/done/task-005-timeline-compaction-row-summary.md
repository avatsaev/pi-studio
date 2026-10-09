# Task 005 — Web-client timeline: `CompactionRow`, reducer upsert, divider renderer — Summary

- **Sprint:** sprints/sprint-074-context-compaction
- **Completed:** 2026-10-09
- **Status:** done

## What was implemented
New `CompactionRow` kind in `row-model.ts`; `reducer.ts` `onCompaction` upserts by `compactionId` (merging only carried fields, keeping the start-time id/timestamp) and every turn end flips a still-`started` row to `canceled`. `timeline/compaction.ts` holds the pure `isCompactionPending` selector and `compactionLabel` formatter. `rows/CompactionRow.tsx` renders the centered-label divider (spinner while started, danger tone on failed, collapsed-by-default markdown summary disclosure), dispatched from `Timeline.tsx`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/timeline/row-model.ts` | `CompactionRow` + union member |
| `packages/web-client/src/timeline/reducer.ts` | `onCompaction`, `cancelStartedCompactions`, turn-end hook |
| `packages/web-client/src/timeline/compaction.ts` (+ `.test.ts`) | new |
| `packages/web-client/src/timeline/reducer.test.ts` | compaction upsert / replay / turn-end tests |
| `packages/web-client/src/features/chat/rows/CompactionRow.tsx`, `rows.module.css` | new renderer + styles |
| `packages/web-client/src/features/chat/Timeline.tsx` | dispatch case |
| `packages/web-client/AGENTS.md` | layout + upsert/turn-end invariant |

## Build & test results
```
$ npx vitest run packages/web-client  -> 99 files, 1322 passed
$ npm run build:web-client; tsc -b packages/web-client -> success
$ oxlint / oxfmt on changed paths      -> clean
```

## Acceptance criteria
- [x] started→completed same id = one row; lone completed = one row; replay-twice idempotent
- [x] started row becomes canceled on turn end; completed rows untouched
- [x] `isCompactionPending` true exactly while a started row exists
- [x] `compactionLabel` documented strings, absent-reason / absent-estimate variants
- [x] Compaction rows don't affect `userMessageCount` (it counts `user` rows only; no code change needed)
- [x] Browser vs dev daemon (mock provider, Vite dev proxy): spinner divider `Compacting context… (manual)` → in place `Context compacted · 168k → ~14k (manual)`; summary toggle expands to "mock compaction summary" (`aria-expanded=true`); hydrated history rows render after reload.

## Follow-ups / TODO(verify)
- None. Tasks 006–008 consume `isCompactionPending`.
