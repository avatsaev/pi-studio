# Task 003 — Left sidebar, nav chrome & command center — Summary

- **Sprint:** sprint-018-ui-primitives-nav-chrome
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented
Built the persistent navigation chrome and command palette:

| Component | What it does |
|-----------|-------------|
| `LeftSidebar` | Host label, grouped workspace list (project/recent), footer nav icons (Home/Schedules/Settings), new-workspace button; pinned wide / absolute overlay compact / hidden per `sidebarMode()` |
| `CommandCenter` | Searchable command palette with keyboard nav (↑↓/Enter/Esc); agents + static actions from `commandCenterItems()`; portaled via `Portal` |
| `ShortcutsDialog` | Lists all `DEFAULT_BINDINGS` grouped by section with per-OS formatting; shows overrides from `KeyboardShortcutOverridesStore`; uses `AdaptiveSheet` |
| `ShortcutDispatcher` | Mounts as a side-effect component; listens on `window.keydown`; routes combos through `dispatchShortcut()` → `onAction` callback |
| `nav-logic.ts` | Re-exports sprint-012/013 models for testability |

28 pure-logic tests covering: sidebar mode derivation (hidden/pinned/overlay), edge-swipe gate,
workspace grouping (project/recent), command-center filter/sort/keyboard-nav reducer,
shortcut platform detection, and the overrides store (set/get/remove/serialize/reset).

## Files created
- `packages/app/src/components/nav/` — 9 new files (4 `.tsx`, 2 `.module.css`, 1 `.ts`, 1 `test`, 1 `index`)
- `packages/app/src/components/index.ts` — exports nav alongside primitives + overlays

## Commands run
```bash
npx vitest run packages/app/src/components/nav/nav.test.ts
# 28 tests passed

npm --workspace @av-pi-studio/app run typecheck
# clean

npx vitest run
# 94 test files, 1105 tests passed

npm --workspace @av-pi-studio/app run build:web
# ✓ 387 kB JS, built in 742ms
```

## Acceptance criteria
- [x] The sidebar lists hosts + nav + projects, collapses/expands, and overlays on compact (mode driven by `sidebarMode()`).
- [x] Command center opens via shortcut/prop, filters/executes actions, keyboard-navigable.
- [x] The shortcuts dialog lists bindings and shows overrides; the dispatcher fires actions.

## Follow-ups / TODO(verify)
- Host switcher UI (choosing between multiple connected hosts) — deferred to sprint-019/hosts screen.
- `HostChooserModal` / add-host modal entry point — deferred to sprint-019/task-001 (onboarding).
- `ShortcutDispatcher` key-combo builder currently constructs combos from native key events; needs cross-platform
  normalization testing on non-Mac for meta vs ctrl combos.
