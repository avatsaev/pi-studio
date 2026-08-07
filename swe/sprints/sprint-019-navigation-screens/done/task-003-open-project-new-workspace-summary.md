# Task 003 — Open-Project & New-Workspace Screens — Summary

- **Sprint:** sprint-019-navigation-screens
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

| Component | What it does |
|-----------|-------------|
| `OpenProjectScreen` | Displays recent projects + manual path entry with validation; browse button (desktop); absolute path enforcement |
| `NewWorkspaceScreen` | Provider/model selector, project picker (worktree-capable only), branch/ref search, initial prompt textarea, launch with gate checking; routes to created workspace |
| `validateProjectPath()` | Pure validator: requires absolute path (/ or ~) |
| `launchGate()` | Returns human-readable block reasons when inputs incomplete |

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/components/screens/OpenProjectScreen.tsx` | created |
| `packages/app/src/components/screens/OpenProjectScreen.module.css` | created |
| `packages/app/src/components/screens/NewWorkspaceScreen.tsx` | created |
| `packages/app/src/components/screens/NewWorkspaceScreen.module.css` | created |
| `packages/app/src/components/screens/index.ts` | added exports |
| `packages/app/src/components/screens/screens.test.ts` | added 15 tests (path validation, new-workspace params/defaults/gate/submit) |

## Build & test results
```
$ npm --workspace @av-pi-studio/app run typecheck
# 0 errors

$ npx vitest run packages/app/src/components/screens/screens.test.ts
# 38 passed

$ npx vitest run
# 95 files, 1143 tests passed
```

## Acceptance criteria
- [x] Open-project picks a project/dir (recent + browse), validates it, and proceeds per host.
- [x] New-workspace selects provider/model + worktree options + initial context and launches, routing to the created workspace (mock client).
- [x] Launch is gated with human-readable reasons when inputs are incomplete.

## Follow-ups / TODO(verify)
- Browse button (OS file dialog) needs Electron IPC integration (sprint-024).
- Provider/model combo boxes currently use native `<select>`; richer Combobox component available but not wired yet (no provider list API mock).
