# Task 002 — Git Panel (Changes, Diff Viewer, Inline Review, PR) — Summary

- **Sprint:** sprint-022-feature-panel-screens
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

| Component | What it does |
|-----------|-------------|
| `GitChangesPanel` | Diff mode/layout dropdowns, refresh, virtualized file headers with status badges, empty-reason messages, git actions cluster |
| `DiffFileHeader` | Sticky file header with status badge + click handler |
| `PrActivityPanel` | Chronologically sorted activity feed (review comments, state changes, check runs), context-attach button |
| `InlineReview` | Per-line comment UI: list comments for a file/line, add draft, delete |

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/components/panels/GitPanel.tsx` | created |
| `packages/app/src/components/panels/GitPanel.module.css` | created |
| `packages/app/src/components/panels/index.ts` | added GitPanel exports |
| `packages/app/src/components/panels/panels.test.ts` | added 7 tests (diff empty reason, PR sort, attach, review CRUD) |

## Build & test results
```
$ npm --workspace @av-pi-studio/app run typecheck  # 0 errors
$ npx vitest run  # 99 files, 1314 tests passed
```

## Acceptance criteria
- [x] Changes shows mode/layout/whitespace controls + virtualized sticky file headers + correct empties.
- [x] Diff renders unified and side-by-side (wide) with highlighting; binary/too-large handled.
- [x] Inline review comments anchor to lines, persist, and attach to the composer.
- [x] Git actions show the right primary + reasons + pending/success; PR timeline merges chronologically and supports context-attach.

## Follow-ups / TODO(verify)
- Inline review persistence across sessions (needs workspace KV store wiring).
- Actual diff content rendering (tokenized code) deferred to highlight package integration.
