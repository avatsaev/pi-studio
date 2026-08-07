# Task 001 — Panel plug-in contract; file explorer panel — Summary

- **Sprint:** sprint-016-feature-panels-ui
- **Completed:** 2026-07-05
- **Status:** done

## Files created

| File | Purpose |
|------|---------|
| `packages/app/src/panels/contract.ts` | Panel registration, pane/focus context, confirm-close, descriptor factory, workspace-available helper |
| `packages/app/src/panels/file-explorer.ts` | Explorer state, lazy tree nodes, DFS flatten, dirs-first sorting, toggle expand, row actions, path safety, upload target, view-state resolver |
| `packages/app/src/panels/index.ts` | Re-exports panels module surface |
| `packages/app/src/panels/panels.test.ts` | 16 tests (contract + explorer) |

## Tests

```
npx vitest run packages/app/src/panels/panels.test.ts
✓ 16 tests passed
```

## Acceptance criteria

- [x] Panel registers via PanelRegistration contract with descriptor hook + optional confirmClose.
- [x] Explorer lazily loads children, sorts dirs-first (name/modified/size), toggles hidden, refreshes.
- [x] Row actions: open-preview, copy-path, download (files only), reveal; path safety rejects outside-workspace.
- [x] Upload resolves target destination path.
- [x] View state resolves unavailable/loading/error/empty/tree correctly.

## Build

```
npm --workspace @av-pi-studio/app run typecheck → success
npm run build                                   → success
```
