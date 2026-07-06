# Task 002 — Tab Strip & Pinned Quick-Launch — Summary

- **Sprint:** sprint-020-workspace-shell-screens
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

| Component | What it does |
|-----------|-------------|
| `TabStrip` | Tab bar with width distribution (icon-min → max, scroll overflow), active highlight, close button, middle-click close, tooltip, per-tab context menu (via DropdownMenu), trailing new-tab actions, and pinned quick-launch buttons |

Consumes: `distributeTabWidths()`, `tabContextMenu()`, `trailingTabActions()`, `quickLaunchButtons()`, `isMiddleClickClose()`, `PinnedTargetsStore`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/components/workspace/TabStrip.tsx` | created |
| `packages/app/src/components/workspace/TabStrip.module.css` | created |
| `packages/app/src/components/workspace/index.ts` | created |
| `packages/app/src/components/workspace/workspace.test.ts` | created — 19 tests |
| `packages/app/src/components/index.ts` | added workspace re-export |

## Build & test results
```
$ npm --workspace @av-pi-studio/app run typecheck  # 0 errors
$ npx vitest run  # 97 files, 1206 tests passed
```

## Acceptance criteria
- [x] Tabs render with width distribution + overflow, active state, and status/attention.
- [x] Context menu + middle-click close operate via the tab model; pins persist and open targets.
- [x] New-tab actions open the correct target kinds via the panel registry.

## Follow-ups / TODO(verify)
- Tab descriptor/icon resolution (provider icon, agent title) currently simplified — full resolution depends on the panel registry + agent directory data.
- Drag-to-reorder tabs deferred to task-003 (pane split DnD).
