# Task 004 — Workspace Header, Compact Switcher & Bulk-Close — Summary

- **Sprint:** sprint-020-workspace-shell-screens
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

| Component | What it does |
|-----------|-------------|
| `WorkspaceHeader` | Title/branch/subtitle, sidebar toggle, overflow menu (new agent/terminal/import/copy), right actions (scripts/open-editor/explorer with badge) from `workspaceHeaderModel()` |
| `CompactSwitcher` | Mobile-class single-pane tab list (active highlight, close buttons) + pinned new-tab actions, from `buildMobileSwitcher()` |
| `BulkCloseDialog` | Confirmation sheet showing `bulkCloseConfirmation()` wording; Confirm/Cancel buttons; calls `onConfirm(plan)` with the full `BulkClosePlan` |

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/components/workspace/WorkspaceHeader.tsx` | created |
| `packages/app/src/components/workspace/WorkspaceHeader.module.css` | created |
| `packages/app/src/components/workspace/CompactSwitcher.tsx` | created |
| `packages/app/src/components/workspace/CompactSwitcher.module.css` | created |
| `packages/app/src/components/workspace/BulkCloseDialog.tsx` | created |
| `packages/app/src/components/workspace/index.ts` | added exports |
| `packages/app/src/components/workspace/workspace.test.ts` | added 12 tests (header model, compact switcher, bulk-close) |

## Build & test results
```
$ npm --workspace @av-pi-studio/app run typecheck  # 0 errors
$ npx vitest run  # 97 files, 1234 tests passed
$ npm --workspace @av-pi-studio/app run build:web  # ✓ 387 kB, 767ms
```

## Acceptance criteria
- [x] The header renders title + actions (scripts/open-in-editor/explorer/focus) wired to the model.
- [x] On compact, the switcher shows one pane + tab list + new actions and hides splits.
- [x] Bulk-close classifies tabs, confirms with correct wording, and executes the plan.

## Follow-ups / TODO(verify)
- Script runner menu popover (run/stop/view-service-url) deferred — needs terminal integration.
- Open-in-editor targets list (VS Code, Cursor, etc.) needs Electron IPC (sprint-024).
