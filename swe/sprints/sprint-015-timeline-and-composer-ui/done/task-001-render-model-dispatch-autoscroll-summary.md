# Task 001 — Timeline reducers, sync planner, render model, row dispatch, autoscroll — Summary

- **Sprint:** sprint-015-timeline-and-composer-ui
- **Completed:** 2026-07-05
- **Status:** done

## Files created

| File | Purpose |
|------|---------|
| `packages/app/src/timeline/reducer.ts` | Merge live + page rows, dedup by seq overlap, compact deltas, detect gaps |
| `packages/app/src/timeline/sync-planner.ts` | resume-from-cursor / fresh-tail plans, page-advance until `hasNewer=false` |
| `packages/app/src/timeline/render-model.ts` | Stable render keys, segment partitioning (virtualized/mounted), height estimates |
| `packages/app/src/timeline/row-dispatch.ts` | Kind→renderer dispatch table, gap-value resolution, unknown fallback |
| `packages/app/src/timeline/autoscroll.ts` | sticky-bottom ↔ detached state machine, anchor row, jump-to-bottom |
| `packages/app/src/timeline/index.ts` | Re-exports all timeline module surface |
| `packages/app/src/timeline/timeline.test.ts` | 28 tests |

## Tests

```
npx vitest run packages/app/src/timeline/timeline.test.ts
✓ 28 tests passed
```

## Acceptance criteria

- [x] Live and page rows merge deterministically without duplicates (authoritative page wins same-seq overlap).
- [x] Reconnect catch-up uses cursor+direction=after, pages until `hasNewer=false`.
- [x] Row dispatch covers all 7 kinds + safe `unknown` fallback.
- [x] sticky-bottom / detached transitions driven by scroll distance; anchor row preserved for prepend stability.
- [x] onJumpToBottom / onMessageSent / onEntry trigger sticky-bottom scroll.

## Build

```
npm --workspace @av-pi-studio/app run typecheck  → success
npm run build                                    → success
```
