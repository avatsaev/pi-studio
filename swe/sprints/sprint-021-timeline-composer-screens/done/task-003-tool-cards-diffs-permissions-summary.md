# Task 003 — Tool-Call Cards, Diff Rows & Permission Prompts — Summary

- **Sprint:** sprint-021-timeline-composer-screens
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

| Component | What it does |
|-----------|-------------|
| `ToolCallCard` | Collapsible card: status icon/shimmer, displayName+summary, expand→detail sections (code/diff/text/json/error) |
| `DiffSection` | Renders `parseDiff` hunks: gutter prefix + content with add/remove/context coloring |
| `PermissionRow` | Renders tool permission prompt (title + option buttons), submits choice, shows resolved state |
| `DetailSectionView` | Discriminated renderer for each `ExpandedDetailSection` kind |

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/components/timeline/ToolCards.tsx` | created |
| `packages/app/src/components/timeline/ToolCards.module.css` | created |
| `packages/app/src/components/timeline/index.ts` | added exports |
| `packages/app/src/components/timeline/timeline.test.ts` | added 11 tests (tool cards, diff rows, permissions) |

## Build & test results
```
$ npm --workspace @av-pi-studio/app run typecheck  # 0 errors
$ npx vitest run  # 98 files, 1274 tests passed
```

## Acceptance criteria
- [x] Tool cards show status/summary, shimmer while running, and expand to detail sections.
- [x] Diff sections render hunks with gutters + stat + highlighting.
- [x] Permission prompts render options, submit a decision, and reflect pending/decided state.

## Follow-ups / TODO(verify)
- Syntax highlighting within diff lines (token-based) deferred to highlight package CSS integration.
- Permission submit to server via client RPC needs real integration (currently local state only).
