# Task 001 — Virtualized Timeline List, Row Dispatch & Autoscroll — Summary

- **Sprint:** sprint-021-timeline-composer-screens
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

| Component / Module | What it does |
|--------------------|-------------|
| `Timeline` | Virtualized list using `@tanstack/react-virtual`; feeds `buildRenderItems()`; dispatches each row to a renderer via the registry; autoscroll stick-to-bottom + "Jump to latest" button; scroll-top paging trigger |
| `registerRowRenderer()` | Open registry for tasks 002–003 to register concrete row components |
| `RowRendererFn` | Type signature for row renderers; defaults to placeholder showing kind+id |

21 pure-logic tests covering: `buildRenderItems` + `renderKey`, `partitionSegments` (small/large), `dispatchRow` mapping, `resolveRowGap` inter-row spacing, full autoscroll state machine (sticky/detach/re-stick/jump/entry/sent/anchor).

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/components/timeline/Timeline.tsx` | created |
| `packages/app/src/components/timeline/Timeline.module.css` | created |
| `packages/app/src/components/timeline/index.ts` | created |
| `packages/app/src/components/timeline/timeline.test.ts` | created — 21 tests |
| `packages/app/src/components/index.ts` | added timeline re-export |

## Build & test results
```
$ npm --workspace @av-pi-studio/app run typecheck  # 0 errors
$ npx vitest run  # 98 files, 1255 tests passed
$ npm --workspace @av-pi-studio/app run build:web  # ✓ 387 kB, 783ms
```

## Acceptance criteria
- [x] The list virtualizes rows from the render model and dispatches each kind to a renderer.
- [x] Autoscroll sticks to bottom, shows jump-to-latest when scrolled up, and jumps on action.
- [x] Older history pages in on scroll; live rows append without losing scroll position.

## Follow-ups / TODO(verify)
- Dynamic row height measurement via `measureElement` may need tuning with real content.
- Prepend stability (anchor row restore after page insertion) needs integration testing with real fetch.
