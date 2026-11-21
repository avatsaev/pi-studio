# Task 003 — Workbench: the Daemons screen (list, local daemon, settings, remove)

- **Sprint:** sprint-110-workbench-daemons-ui
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench (features/daemons, shell)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
A modal Daemons screen lists the entries, shows the local daemon's state with the actions that apply, holds the two settings, and removes an entry after a confirm. It exists only when the host has a registry.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Public contract 4 (row "Daemons screen"), § Public contract 6, § Adding, editing, removing (Remove), § Error handling (first launch without CLI or on Windows; `failed`; auto-start off)
- `swe/grills/desktop-native-shell.md` D11, D14, D18, D22
- `packages/workbench/src/features/daemons/` (store, hook, labels: task-001)
- `packages/workbench/src/shell/WorkspaceShell.tsx` (where the settings dialog and the toast viewport are mounted), `src/features/settings/SettingsDialog.tsx` (an existing modal to match)
- `packages/ui-library` (`Dialog`, `Button`, `IconButton`, `Switch`, `TextInput`, `StatusDot`, `StatusBadge`, `EmptyState`)

## What to build
- **The screen**, mounted once in the shell when `host.daemons` exists, opened and closed through the store of task-001:
  - **Entries**, in registry order. Each row: name, kind ("This machine", "Address", "Relay"), the address for a direct entry, a marker on the current one, and its actions: Open (switch to it; hidden on the current one), Edit, Remove. The local entry has no Remove. The Add and Edit buttons are present and open nothing yet (task-004 supplies the forms).
  - **The local entry's row** also shows the local state's label and, from task-001's rules, Start, Stop, Restart or Retry. `cli_missing` shows the install command, `cli_outdated` the update command with the found version, `unsupported` the explanation and no action. A configured path that is not an executable file is named.
  - **A banner** for the boot or action error held in the store, with the message of task-001. `local_stopped` is shown as a plain state, not as an error.
  - **Settings:** a switch "Start the local daemon when this machine is opened" and a field "Path of the pi-studio CLI" (empty means "find it"), saved through `setSettings`. A refused value shows the reason and keeps the previous one.
- **Remove:** `host.dialogs.confirm` naming the entry, then `remove(id)`. What follows when it was the current entry is task-005.
- **Actions** call the host and show a rejection's message in the banner; `busy` reads "Another action is running".
- Opening the screen calls `local.refresh()` once, so the state shown is current.
- The screen's view model (rows, which actions each has, banner) is a pure function with tests.
- Keyboard and focus as in the design system's dialog: focus moves in, Escape closes, focus returns.

## Out of scope
- The Add and Edit forms (task-004).
- Disconnecting on stop or removal, the `wrong_key` marker, the menu's manage request (task-005).

## Acceptance criteria
- [ ] The view model for (local stopped, direct B current, relay C) has three rows; `local` has Start and no Remove; B has no Open; C has Open, Edit, Remove.
- [ ] For `cli_missing` with a configured path the row names that path and offers Retry; for `unsupported` it offers nothing and shows the explanation.
- [ ] `local_stopped` produces a banner without error styling; `cli_outdated` produces one with the update command and the version.
- [ ] With the in-memory registry: Remove on B asks, and "no" removes nothing; "yes" removes B and the row is gone.
- [ ] Saving a CLI path calls `setSettings` once with the trimmed path, and an empty field with `null`.
- [ ] With no `daemons` member nothing is mounted: the web client has no Daemons screen.
- [ ] `npm run build:workbench`, `npm run build:web-client` and the workbench's tests pass.

## Test / verification plan
- `npx vitest run packages/workbench/src/features/daemons`
- `npm run build:workbench && npm run build:web-client`
- `npx oxfmt <changed files>`; `npm run lint`
- The screen is seen and driven in the desktop webview in task-007.

## Notes
- **Found at planning time:** the web client has no registry, so this screen cannot be opened in a browser. Its decisions are unit-tested as pure modules and it is exercised live in the desktop webview (task-007); that is why the wiring sprint precedes this one.
- Runs in parallel with task-002.
- Long names and addresses are ellipsised; sizes and colours come from design tokens.
