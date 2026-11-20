# Task 003 — Workbench: the Daemons screen — Summary

- **Sprint:** sprint-110-workbench-daemons-ui
- **Completed:** 2026-11-20
- **Status:** done. I ran no browser check; that is sprint-110/task-007.

## What was implemented
- A modal "Daemons" screen, mounted once in `WorkspaceShell`. `DaemonsScreen()` returns `null` when `getHost().daemons` is absent, so the web client draws nothing. The screen opens and closes through `useDaemonsStore.open`.
- **Rows**, in registry order. Each shows name, kind ("This machine" / "Address" / "Relay"), the address for a direct entry, a "Current" mark, and its actions.
  - Open is hidden on the current entry, Remove on the local one.
  - Edit and the "Add daemon" button are drawn **disabled**, because task-004 supplies the forms. Say so if you want them enabled and inert.
  - The local row also shows the label and tone from `localStateView`, plus Start / Stop / Restart / Retry.
- **Local notices:**
  - `cli_missing` shows the install command, and when a path is configured the label names it.
  - `cli_outdated` shows the update command and the found version.
  - `unsupported` shows the explanation and no action.
- **Banner** for the store's error. `local_stopped` and `no_current` get `role="status"` and an info style; real errors get `role="alert"` and an error style. For `cli_outdated`, the detail adds the found version taken from the snapshot.
- **Settings:**
  - The auto-start `Switch` saves immediately.
  - The CLI path field (Enter or Save) calls `setSettings({ cliPath })` with the trimmed path, or `null` when empty. Save is offered only when the value would change.
  - A refused value shows the host's reason under the field and restores the previous text.
- **Remove:** `host.dialogs.confirm` names the entry, then `remove(id)`. Answering no does nothing.
- **Action errors:** a rejection from Open, a local action or Remove goes to the banner. A stale banner is cleared before each action and when the screen closes.
- **Refresh on open:** `local.refresh()` is called once each time the screen opens; its outcome is not shown.
- **Dialog focus** is the `Dialog` primitive's own handling: focus moves in, Escape closes, focus returns.
- Task-005 owns the Stop confirm and the disconnect, so Stop calls the host directly.
- Open calls `switchTo` directly. The D25 "file transfers running" confirm is not implemented here; it is not in this task's scope.

## Files created / changed
| File | Status | Responsibility |
|---|---|---|
| `packages/workbench/src/features/daemons/daemons-screen-view.ts` | new | Pure view model: `buildDaemonsScreenView`, `bannerView`, `cliPathFromField` / `cliPathToField` / `cliPathChanged`, `settingsFailureText` |
| `packages/workbench/src/features/daemons/daemons-screen-actions.ts` | new | Host calls that return a failure code or `null`: `openEntry`, `runLocalAction`, `removeEntry`, `removeConfirmMessage`, `saveAutoStart`, `saveCliPath` |
| `packages/workbench/src/features/daemons/DaemonsScreen.tsx` | new | The modal (rows, banner, settings) |
| `packages/workbench/src/features/daemons/DaemonsScreen.module.css` | new | Styles: tokens only, `rem`-scaled font-size tokens, long text ellipsised |
| `packages/workbench/src/features/daemons/daemons-screen-view.test.ts` | new | 29 tests: rows, actions per row, local notices, banner tones, field rules, failure text |
| `packages/workbench/src/features/daemons/daemons-screen-actions.test.ts` | new | 15 tests against the in-memory registry: Remove no/yes/refused, local actions, Open, settings, mount |
| `packages/workbench/src/shell/WorkspaceShell.tsx` | changed | Imports and mounts `<DaemonsScreen />` |

I did not change task-001's files.

## Build & test results
- `npx vitest run packages/workbench/src/features/daemons`: 5 files, 71 tests passed.
- `npx vitest run packages/workbench/src/design-tokens.test.ts packages/workbench/src/shell`: 13 tests passed.
- `npm run build:workbench`: passed, including `check-dist`.
- `npm run build:web-client`: passed; the only warning is the existing chunk-size notice.
- `npx oxfmt` and `npx oxlint` on the changed files: clean, no warnings.
- I did not run `npm run lint` repo-wide.

## Acceptance criteria
- [x] The view model for (local stopped, direct B current, relay C) has three rows; `local` has Start and no Remove; B has no Open; C has Open, Edit, Remove. Checked in `daemons-screen-view.test.ts`.
- [x] `cli_missing` with a path names it and offers Retry; `unsupported` offers nothing and shows the explanation. Checked in `daemons-screen-view.test.ts`.
- [x] `local_stopped` gives a banner with tone `info`; `cli_outdated` gives one with the update command and the version. Checked in `daemons-screen-view.test.ts`.
- [x] With the in-memory registry, Remove on B asks, "no" removes nothing, and "yes" removes B. Checked in `daemons-screen-actions.test.ts`.
- [x] Saving a CLI path calls `setSettings` once with the trimmed path, and an empty field with `null`. Checked with a recording wrapper in `daemons-screen-actions.test.ts`.
- [x] With no `daemons` member nothing is mounted. `DaemonsScreen()` returns `null` for a host without a registry, checked in `daemons-screen-actions.test.ts`.
- [x] `npm run build:workbench`, `npm run build:web-client` and the workbench tests pass.

## Follow-ups / TODO(verify)
- Drive the screen in the desktop webview in task-007: the focus return, the open-time refresh, and the Edit and Add buttons, which are drawn disabled.
- Task-004 enables Edit and Add and adds the forms. The component needs `onAdd` / `onEdit` handlers, or the forms mounted inside it.
- Task-005 wraps the Stop confirm and the disconnect around `runLocalAction(daemons, "stop")` in `daemons-screen-actions.ts`. It also owns the `wrong_key` marker, which would sit in the row view.
- `busy` reads "Another action on the local daemon is still running." (task-001's text), not "Another action is running". Change `ERROR_VIEWS.busy` if you want the shorter wording.
- The commands are shown as selectable `<code>`; there is no copy button.
- After saving a CLI path the local state is not re-probed; the user presses Retry. Whether the host re-probes on a `cliPath` change is up to the host.

## Proposed doc edits for the orchestrator
**`packages/workbench/AGENTS.md`, Application reference, near the daemons feature (add):**
> `features/daemons/` (sprint-110): `DaemonsScreen.tsx` — the modal Daemons screen mounted once in `WorkspaceShell`; renders nothing without `host.daemons`; open state and banner error come from `useDaemonsStore`. `daemons-screen-view.ts` — pure view model (`buildDaemonsScreenView`: rows with `open`/`edit`/`remove` actions, the local row's state, actions and notice; `bannerView`; the CLI-path field rules `cliPathFromField` / `cliPathToField` / `cliPathChanged`; `settingsFailureText`). `daemons-screen-actions.ts` — host calls returning a failure code or `null` (`openEntry`, `runLocalAction`, `removeEntry` which confirms through `host.dialogs`, `saveAutoStart`, `saveCliPath`). Opening the screen calls `local.refresh()` once. Closing it clears the banner error. Edit and "Add daemon" are disabled until sprint-110/task-004.

**Source layout tree (`features/` line):** add "`features/daemons/` (registry store, hook, presentation rules, connect-current, Daemons screen)".

**`swe/sprints/sprint-110-workbench-daemons-ui/in_progress/task-003-daemons-screen.md`:** move to `done/` with this summary.

## Wave gate (orchestrator)
```
Wave gate (t002+t003 together): npx vitest run packages/workbench 129 files / 1625 tests passed; build:workbench OK; build:web-client OK; oxlint: no warnings in features/daemons or features/connection. AGENTS layout updated by the orchestrator.
```
