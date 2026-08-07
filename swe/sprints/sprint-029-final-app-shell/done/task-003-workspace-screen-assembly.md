# Task 003 — Assemble the real Workspace screen (tabs, panes, header)

## Why this task exists

`LiveWorkspacePage` in `LivePages.tsx` currently renders `Timeline` + `Composer`
directly in an ad hoc container. The real workspace chrome — `WorkspaceScreen`
(route gating + form-factor composition), `TabStrip`, `PaneTree` (split/DnD),
`WorkspaceHeader` (switcher/bulk-close), and `PaneContentRouter` (tab→panel
routing with keepalive, built in sprint 024) — already exists and is tested, but
is not mounted anywhere in the live app.

## Reference

- `clean-room-scope/features/workspace-ui.md`
- `packages/app/src/components/screens/WorkspaceScreen.tsx`
- `packages/app/src/components/workspace/{TabStrip,PaneTree,WorkspaceHeader,PaneContentRouter}.tsx`
- `packages/app/src/hooks/use-workspace-route.ts`, `use-workspace-shell.ts`
  (sprint 024 — already wired to the layout store; currently unused by the router)
- `packages/app/src/store/workspace-layout-store.ts`

## Scope

1. Replace `LiveWorkspacePage` in the router with a composition that mounts
   `WorkspaceScreen` fed by `useWorkspaceRoute()` / `useWorkspaceShell()`
   (sprint 024 hooks — confirm they still match current store shape; fix drift
   if any) driving `TabStrip` + `WorkspaceHeader` + `PaneContentRouter`.
2. Ensure the composer/timeline panel (already correct inside
   `PaneContentRouter`) is reachable as the default/seed tab for a freshly
   created agent (reuse `workspace/seeding.ts` from sprint 014 if not already
   wired).
3. Confirm keepalive (`workspace/keepalive.ts`) correctly preserves
   terminal/explorer state when switching tabs, now that this is exercised by
   real navigation instead of only unit tests.

## Out of scope

- Boot gating (task-004).

## Acceptance

- Navigating to `/workspace/:agentId` renders the full tab strip + header +
  pane area, not the previous bare Timeline+Composer stack.
- Creating a new agent via `/new` seeds a default tab and lands in the real
  workspace shell.
- `npx tsc -b packages/app` clean; full `npm test` green.
- Manual smoke: switch between Timeline/Explorer/Git/Terminal tabs for a live
  agent without losing scroll position or terminal buffer (keepalive works).
