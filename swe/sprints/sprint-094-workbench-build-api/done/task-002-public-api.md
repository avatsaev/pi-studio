# Task 002 — Public API: regions, hooks, guards

- **Sprint:** sprint-094-workbench-build-api
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench (entry, shell)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Export exactly the API the spec lists, with the guards that make misuse fail clearly.

## Context / why
Decided 2026-11-14: the first version exposes the whole app plus the shell regions and three hooks, so the desktop app can rearrange the shell and replace the connection bar. Everything else stays private so it can keep changing.

## Scope references
- `swe/architecture/workbench-package.md` § Root entry: components, § Root entry: hooks for a custom shell, § Root entry: host, § Stability, § Error handling, § TODO(verify)
- `packages/workbench/src/index.ts`
- `packages/workbench/src/shell/`
- `packages/workbench/src/features/workspace/TabPanelHost.tsx`, `features/connection/ConnectionBar.tsx`, `features/sessions/SessionList.tsx`, `features/files/RightSidebar.tsx`, `features/workspace/StatusBar.tsx`, `features/workspace-picker/OpenWorkspaceDialog.tsx`, `features/settings/SettingsDialog.tsx`
- `packages/workbench/src/stores/ui-store.ts`, `lib/connection/connection-store.ts`

## What to build
- Root exports: `Workbench`, `WorkbenchProvider`, `WorkbenchBoot`, `WorkspaceShell`, `ConnectionBar`, `SessionList`, `PaneArea` (the public name of `TabPanelHost`), `RightSidebar`, `StatusBar`, `OpenWorkspaceDialog`, `SettingsDialog` (still lazy), `useConnection`, `useShellLayout`, `useSettingsDialog`, `createBrowserHost`, and the host types.
- `useConnection()` returns `status`, `serverInfo`, `error`, `connect(options)`, `disconnect()`. `useShellLayout()` returns, for each sidebar, `collapsed`, `width`, `toggle()`, `resize(delta)`. `useSettingsDialog()` returns `open`, `openSettings()`, `closeSettings()`. All three are views over the existing stores; the stores are not exported.
- A region or hook used outside `WorkbenchProvider` throws an error that names the missing provider.
- A second mounted `WorkbenchBoot` does nothing and warns once in development. A second `Workbench` in one document warns once in development.
- Remove every temporary export.
- Extend `check-dist` to assert that the built root entry exports exactly the documented names.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Exporting stores, feature internals or the timeline components.
- Renaming files on disk.

## Acceptance criteria
- [ ] The built entry's export list equals the spec's list.
- [ ] A deep import such as `@av-pi-studio/workbench/features/chat/Composer.js` fails to resolve.
- [ ] `Workbench` equals provider + boot + shell: composing those three by hand renders the same application.
- [ ] A custom shell built from `WorkbenchProvider`, `WorkbenchBoot`, `SessionList` and `PaneArea`, connecting through `useConnection()`, works in `web-client`'s dev server (temporary local edit, reverted).
- [ ] The settings chunk is not part of the entry chunk.
- [ ] Rendering `SessionList` without the provider throws the documented error.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- `npm run build:workbench` (runs `check-dist`)
- `npx vitest run packages/workbench/src/shell`
- The custom-shell check described above.

## Notes
- Spec TODO(verify): confirm `PaneArea` and `WorkspaceShell` as public names with the engineer before the first publish; names are hard to change afterwards.
- `SettingsDialog`: the spike showed a lazily loaded component exported from the entry keeps its own chunk (`swe/notes/workbench-packaging-spike.md` #5). Export it with `lazy(...)`.
