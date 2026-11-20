# Task 002 — Workbench: the connection bar becomes a switcher

- **Sprint:** sprint-110-workbench-daemons-ui
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench (features/connection)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
When the host has a registry, the connection bar shows the current entry's name and status and opens a list to switch from. Without a registry the bar is exactly what it is today.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Public contract 4 (row "Connection bar"), § Switching (first line), § Error handling (unreachable entry at launch: the switcher still works)
- `packages/workbench/src/features/connection/ConnectionBar.tsx`, `ConnectionBar.module.css`, `connection-presentation.ts` (`connectionBarView`, `ConnectionBarKind`), `connection-presentation.test.ts`
- `packages/workbench/src/features/daemons/` (the store, hook and labels: task-001)
- `packages/ui-library` (`Menu`, `Popover`, `StatusDot`)

## What to build
- **With `host.daemons`:** the address field, the password field and the Connect button are replaced by one control:
  - it shows the current entry's name (ellipsised when long) and the connection status the bar shows today; for the local entry while its daemon is not running, the local state's label instead ("Starting…");
  - with no current entry it reads "No daemon selected";
  - opening it lists the entries in registry order, the current one marked, each with its kind, then "Manage daemons…".
- **Choosing an entry:** the current one while connected does nothing; the current one while not connected reconnects (the shared action of task-001); another one calls `switchTo`. A `switchTo` that rejects shows its message as a toast.
- **"Manage daemons…"** opens the Daemons screen through the store.
- Disconnect, Retry and the settings gear stay where they are. Retry uses the shared reconnect action, so it asks the registry again (a local daemon stopped meanwhile is started when the setting says so).
- The switcher's view model (text, status, the list, what a choice does) is a pure function with tests, beside `connectionBarView`.
- Keyboard: the control and the list are reachable and operable without a pointer, as the design system's menu is.

## Out of scope
- The Daemons screen (task-003). The native menu (sprint-109/task-004).

## Acceptance criteria
- [ ] The view model for (direct B current, connected) shows B's name and the connected status; for (local current, state `starting`) it shows "Starting…".
- [ ] The list has every entry in order with only the current one marked, and ends with "Manage daemons…".
- [ ] Choosing the current entry while connected yields "nothing"; while in error yields "reconnect"; choosing another yields "switch" with its id.
- [ ] With no `daemons` member the existing connection-bar tests pass unchanged and the bar's markup is the same.
- [ ] A 64-character name does not widen the bar: it is ellipsised.
- [ ] `npm run build:workbench`, `npm run build:web-client` and the workbench's tests pass.

## Test / verification plan
- `npx vitest run packages/workbench/src/features/connection packages/workbench/src/features/daemons`
- `npm run build:workbench && npm run build:web-client`
- `npx oxfmt <changed files>`; `npm run lint`
- Browser: the web client's connection bar looks and behaves as before (no registry there).
- The switcher itself is seen in the desktop webview in task-007.

## Notes
- Runs in parallel with task-003: this task owns `features/connection/`, that one new files under `features/daemons/` and the shell mount.
- Font sizes and colours come from design tokens; buttons reset background, border and cursor explicitly (repository convention).
