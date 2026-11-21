# Task 006 — Frontend: `dialogs` and `links.openExternal` in the desktop host

- **Sprint:** sprint-104-desktop-dialogs-links-save
- **Status:** done
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src/host
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** task-001, task-004, sprint-103/task-003

## Goal
In the app window, the workbench's confirms and alerts are native dialogs and its external links open in the system's default application.

## Context / why
The desktop host still takes `dialogs` and `links` from the browser host: the webview's own dialogs, and anchors that open a new webview window or nothing at all.

## Scope references
- `swe/features/desktop-native-host.md` § Public contract 2 (rows `dialogs.confirm`, `dialogs.alert`, `links.openExternal`), § Dialogs, § External links
- `desktop/apps/pistudiodesktop/src/host/` (`desktop-host.ts`, `ipc.ts`: sprint-103/task-003)
- `packages/workbench/src/host/types.ts` (`HostDialogs` without `prompt` after task-001, `HostLinks`)

## What to build
- `dialogs.confirm(message)` → `dialog_confirm`; resolves the answer. If the call itself fails, resolve `false` (the action does not run) and log.
- `dialogs.alert(message)` → `dialog_alert`; resolves when closed, also when the call fails.
- `links.openExternal(url)` → `open_external`, not awaited; a failure is logged.
- Unit tests over a fake `ipc`.

## Out of scope
- Scheme checking (Rust, task-004). `files.saveToDisk` (task-007).

## Acceptance criteria
- [ ] `confirm` resolves `true` and `false` as the fake answers, and `false` when the fake rejects.
- [ ] `alert` resolves in both cases.
- [ ] `openExternal` sends the URL unchanged and returns at once.
- [ ] `npm run check`, `npm run lint`, `npm test` and `cargo xtask web` pass.

## Test / verification plan
- In `desktop/apps/pistudiodesktop`: `npm run check && npm run lint && npm test`
- `cargo xtask web` in `desktop/`

## Notes
- Depends on task-001: the host is typed against `HostDialogs` without `prompt`.
- Depends on sprint-103/task-003 for `desktop-host.ts`; task-007 edits the same file next.
