# Task 001 — Workspace Screen Scaffold & Route Gating — Summary

- **Sprint:** sprint-020-workspace-shell-screens
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

| Component | What it does |
|-----------|-------------|
| `WorkspaceScreen` | Route component for `/h/:serverId/workspace/:workspaceId`; drives the `resolveWorkspaceRouteGate()` state machine → renders gate UI (splash/reconnecting/unreachable/loading/missing/foreign/directory-missing) or the ready shell frame |
| `GateView` | Internal gate renderer: spinner for splash/loading; messages+actions for reconnecting/unreachable/missing; redirect for foreign; info for directory-missing |
| `WorkspaceShell` | Shell frame: header slot + tab-strip slot + body row (explorer sidebar + pane area); controlled by `composeWorkspaceScreen()` |

## Files created / changed
| File | Change |
|------|--------|
| `packages/app/src/components/screens/WorkspaceScreen.tsx` | created |
| `packages/app/src/components/screens/WorkspaceScreen.module.css` | created |
| `packages/app/src/components/screens/index.ts` | added WorkspaceScreen export |
| `packages/app/src/components/screens/workspace.test.ts` | created — 20 tests |

## Build & test results
```
$ npm --workspace @av-pi-studio/app run typecheck  # 0 errors
$ npx vitest run packages/app/src/components/screens/workspace.test.ts  # 20 passed
$ npx vitest run  # 96 files, 1187 tests passed
```

## Acceptance criteria
- [x] Each gate state renders its documented UI; retry/reconnect transitions work.
- [x] On ready, the shell frame mounts with the persisted layout (or a seeded draft tab).
- [x] Foreign-host / directory-missing states match the model.

## Follow-ups / TODO(verify)
- Shell frame slots (header, tab-strip, explorer, pane-area) are currently empty ReactNode props — filled by tasks 002–004.
