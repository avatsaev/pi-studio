# Task 001 — Root shell assembly (theme, sidebar, command center, toasts) — Summary

- **Sprint:** sprint-029-final-app-shell
- **Completed:** 2026-07-06
- **Status:** done

## What was implemented

Replaced the ad hoc, hand-rolled `AppShell.tsx` (hardcoded dark palette, inline
`<nav>` list) with the real root shell, assembled from already-built,
already-tested sprint 017/018 components:

- **Theme**: confirmed `ThemeBoundary` is already applied one level up, in
  `AppProviders.tsx` (`QueryClientProvider → ThemeBoundary → ConnectionProvider
  → children`). `AppShell` does not re-wrap in a second `ThemeBoundary`
  instance (that would create a duplicate `AppearanceController` and double
  system-theme listeners) — it simply consumes the `--pi-*` CSS variables the
  existing boundary already sets on `:root`. This is a deliberate deviation
  from the task's literal wording ("wrap children in ThemeBoundary"); the
  intent — "stop using hardcoded `PI_DARK_VARS`, use the real theme system" —
  is satisfied without redundant provider nesting.
- **Sidebar**: renders the real `LeftSidebar` component (`mode="pinned"`),
  fed by a new pure adapter (`connectionToHostSnapshots`) that projects the
  single-daemon `ConnectionProvider` state into the `HostRuntimeSnapshot[]`
  shape the (multi-host-capable) sidebar expects.
- **Command center**: mounts `CommandCenter`, opened via the sidebar's
  `onOpenCommandCenter` and the `toggle-command-center` shortcut action. Fed
  live agent data via a second adapter (`toCommandCenterAgents`) that maps
  session-store `AgentEntry` records (daemon `AgentStatus` enum, raw
  `permissions` record) into `CommandCenterAgent` rows (UI status enum,
  derived `requiresAttention`/`pendingPermissionCount`).
- **Shortcuts**: mounts `ShortcutDispatcher` (global keydown → action id) and
  `ShortcutsDialog` (the `?` help overlay), wired to local `useState` toggles.
- **Toasts/portal**: kept `ToastProvider`/`ToastHost` and the
  `#pi-portal-root` div (unchanged behavior, now themed via CSS Modules
  instead of an inline style object).
- Deleted the hand-rolled `NAV_ITEMS`/`ConnectionStatusBar` — their
  responsibilities now live in `LeftSidebar` (footer nav icons: Home,
  Schedules, Settings, New) plus a themed "connecting/no daemon" splash state
  in `AppShell` itself (still needed — `LeftSidebar` assumes an already-known
  host).
- Minimal route-tree update: `routes.tsx` now mounts `AppShell` as the root
  layout (previously flat `PlaceholderScreen`s with no shell at all, from the
  interim cleanup pass). Route paths were only lightly aligned toward
  `route-grammar.ts`'s shape (`/h/:serverId/...`) so sidebar navigation
  doesn't 404 immediately — full route-grammar parsing/redirects are
  out of scope here (task-004).

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/router/shell-adapters.ts` | created — `toHostConnectionStatus`, `connectionToHostSnapshots`, `activeHostSnapshot`, `toCommandCenterStatus`, `pendingPermissionCount`, `toCommandCenterAgents` |
| `packages/app/src/router/shell-adapters.test.ts` | created — 12 unit tests |
| `packages/app/src/router/AppShell.tsx` | rewritten — real shell assembly |
| `packages/app/src/router/AppShell.module.css` | created — CSS Module using `--pi-*` vars |
| `packages/app/src/router/routes.tsx` | modified — mounts `AppShell` as root layout |
| `packages/app/src/router/index.ts` | modified — re-added `AppShell` export |
| `packages/app/vite.config.ts` | modified — added WS proxy (`/daemon-ws`, carried over from prior debugging) + `allowedHosts: true` for dev diagnostics |

## How it satisfies the scope

- ✅ `AppShell.tsx` renders `LeftSidebar` + `CommandCenter` + `ShortcutDispatcher`
  + `ShortcutsDialog`, no hardcoded color hex values outside of `var(--pi-*,
  fallback)` (same convention as `LeftSidebar.module.css`).
- ✅ New adapter functions (`shell-adapters.ts`) have a dedicated Vitest test
  file — 12 tests covering connection-status mapping, empty/connecting/
  online/error snapshot shapes, agent-status mapping, and pending-permission
  derivation.
- ✅ `npx tsc -b packages/app` clean.
- ✅ Full `npm test` green: 110 files / 1474 tests (12 new).
- ✅ Visual smoke check (Docker Chrome screenshot against the live Vite dev
  server + running daemon): sidebar renders with real design tokens ("Pi-Studio"
  label, dark-green accent palette, Home/Schedules/Settings/New footer icons),
  not the old hardcoded palette.

## Build & test results

```
$ npx tsc -b packages/app
(no output — clean)

$ npm test
 Test Files  110 passed (110)
      Tests  1474 passed (1474)
```

## Acceptance criteria
- [x] `AppShell.tsx` renders `LeftSidebar` + `CommandCenter` + `ShortcutDispatcher`
      + `ThemeBoundary`'s effects, with no hardcoded color hex values (only
      `var(..., fallback)` per existing convention) — verified by grep + code
      review.
- [x] New adapter function has a Vitest unit test file — `shell-adapters.test.ts`,
      12 passing tests.
- [x] `npx tsc -b packages/app` clean; full `npm test` still green — verified.
- [x] Visual smoke check: sidebar renders with real design tokens — verified via
      screenshot against the live dev server. Cmd+K/`?` keyboard wiring verified
      by code review + existing sprint-018 dispatcher/registry unit tests
      (`toggle-command-center` / `show-shortcuts` action ids wired to local
      state); no live keypress-simulation tool was available in this session to
      capture a screenshot of the opened overlays.

## Follow-ups / TODO(verify)
- `toCommandCenterStatus`/`pendingPermissionCount`: the daemon's `AgentStatus`
  enum (`initializing|idle|running|error|closed`) has no `waiting`/`archived`
  equivalents yet; mapped to closest analogues (`queued`/`finished`). Revisit
  once archive/soft-delete and tool-permission-wait states are surfaced
  client-side.
- `LeftSidebar`'s `workspaces` prop is passed `[]` — real workspace data wiring
  is task-002/003 territory (Sessions/Schedules/Settings screens, then the
  Workspace screen assembly).
- Route tree in `routes.tsx` is intentionally minimal/placeholder-backed;
  task-004 (boot gating + route grammar) will replace it with the full
  `route-grammar.ts`-driven tree, onboarding/pairing redirects, and
  last-workspace restore.
- `vite.config.ts`'s `allowedHosts: true` is a dev-only convenience (mirrors
  the daemon's `hostnames: true`) to allow the Docker-based headless-Chrome
  smoke-test tooling to reach the dev server; should be reviewed before any
  production/staging build target is introduced.
