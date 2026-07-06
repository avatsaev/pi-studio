# Task 001 — Root shell assembly (theme, sidebar, command center, toasts)

## Why this task exists

Sprints 017–022 built the individual pieces of the app chrome as isolated, tested
components: `ThemeBoundary`/CSS bridge (017), `LeftSidebar` + `CommandCenter` (018),
`ToastProvider`/`ToastHost` + overlay portal (018), `ShortcutDispatcher` +
`ShortcutsDialog` (018). Sprints 023–024 wired live daemon data into hooks/stores,
but the root layout that assembles all of the above into ONE persistent shell
(matching Paseo's `packages/app/src/app/_layout.tsx` composition) was never built —
instead an ad hoc, hand-rolled `AppShell.tsx` was written with inline styles,
hardcoded hex colors, and a bespoke nav list, purely to unblock data-wiring work.

This task replaces that placeholder with the real, final shell.

## Reference

- Paseo layout for comparison: `~/DEV/paseo/packages/app/src/app/_layout.tsx`
  (persistent `LeftSidebar` + `CommandCenter` + toast/dialog overlays wrapping a
  routed `Stack`, driven by host-runtime state, sidebar-animation, boot state).
- `clean-room-scope/architecture/client-app-runtime.md` § App shell / boot sequence
- `clean-room-scope/features/app-navigation-screens.md` § Left sidebar, § Command center
- Already-built components to use (do NOT re-implement):
  - `packages/app/src/theme/ThemeBoundary.tsx`, `packages/app/src/theme/css-bridge.ts`
  - `packages/app/src/components/nav/LeftSidebar.tsx`, `CommandCenter.tsx`,
    `ShortcutDispatcher.tsx`, `ShortcutsDialog.tsx`
  - `packages/app/src/components/overlays/ToastContext.tsx`, `Toast.tsx` (`ToastHost`)
  - `packages/app/src/components/overlays/Portal.tsx` (`#pi-portal-root` host)

## Scope

1. Rewrite `packages/app/src/router/AppShell.tsx` to:
   - Wrap children in `ThemeBoundary` (real theme/CSS-variable bridge), not the
     hardcoded `PI_DARK_VARS` object.
   - Render the real `LeftSidebar` component (not the ad hoc `<nav>` list), fed by
     `useHostDirectory()`/`useAgentDirectory()`-style hooks from sprint 023/024
     (map connection-provider state → `HostRuntimeSnapshot[]` shape the sidebar expects).
   - Mount `CommandCenter` (Cmd+K) and wire `onOpenCommandCenter` from the sidebar.
   - Mount `ShortcutDispatcher` + `ShortcutsDialog` at the shell root.
   - Keep `ToastProvider`/`ToastHost` and the `#pi-portal-root` div (already correct).
   - Preserve the existing "connecting" splash state, but re-theme it via
     `ThemeBoundary` instead of inline `PI_DARK_VARS`.
2. Delete the hand-rolled `NAV_ITEMS`/`ConnectionStatusBar` inline nav — its
   responsibilities move into `LeftSidebar` (nav links) and a small status
   indicator slot within it (or the sidebar's existing status affordance if one
   exists; otherwise keep a minimal status row but themed via CSS variables, not
   inline hex).
3. Add an adapter function (pure, testable) that maps the single-daemon
   `ConnectionProvider` state (`useConnectionStatus()`, `useHostDirectory()` if it
   exists, else the raw connection state) into the `HostRuntimeSnapshot[]` shape
   `LeftSidebar` expects. Since Pi-Studio (unlike Paseo) targets one daemon
   connection in this phase, this adapter can project the single connection into
   a one-element `hosts` array — write this as a small pure function with unit
   tests, not inline in the component.

## Out of scope (later tasks in this sprint)

- Replacing the throwaway `LivePages.tsx` screens with the real `HomeScreen`/
  `SessionsScreen`/`SchedulesScreen`/`SettingsScreen` components (task-002).
- Workspace screen assembly (`WorkspaceScreen`, `TabStrip`, `PaneTree`,
  `WorkspaceHeader`, `PaneContentRouter`) (task-003).
- Boot gating / route-grammar wiring (task-004).

## Acceptance

- `AppShell.tsx` renders `LeftSidebar` + `CommandCenter` + `ShortcutDispatcher` +
  `ThemeBoundary`, with no hardcoded color hex values remaining in the file.
- New adapter function has a Vitest unit test file.
- `npx tsc -b packages/app` clean; full `npm test` still green.
- Visual smoke check: sidebar renders with the app's real design tokens (not the
  temporary dark palette), Cmd+K opens the command center, `?` opens the
  shortcuts dialog.
