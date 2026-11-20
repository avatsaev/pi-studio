# Task 005 — Frontend: the `daemons` member of the desktop host

- **Sprint:** sprint-109-desktop-registry-wiring
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src/host
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-003

## Goal
The desktop host gives the workbench a working `daemons` member and `app.minDaemonVersion`, backed by the app's commands and events.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Public contract 3, § Switching ("make sure pending storage writes have reached Rust")
- `swe/features/desktop-native-host.md` § Public contract 2 (rows `daemons`, `app`)
- `desktop/apps/pistudiodesktop/src/host/` (`desktop-host.ts`, `ipc.ts`, the storage adapter and snapshot validation: sprint-103/task-003 and later)
- `packages/workbench/src/host/types.ts` (`HostDaemons`, `DaemonError`: task-001)
- The app's page commands and events: `engine_command`, `daemon_resolve_current`, `daemons_changed`, `daemons_manage` (task-002), `daemon_switch` (task-003)

## What to build
- **Snapshot validation** accepts `daemons` (view, local state, settings) and `app.minDaemonVersion`; a snapshot without them fails as any malformed snapshot does.
- **`snapshot()`** returns the last view held in memory, synchronously. **`subscribe`** fires after each `daemons_changed` event, once the held view was replaced.
- **`add`, `update`, `remove`, `local.*`, `setSettings`** call `engine_command`. An error text that is one of the spec's codes rejects with a `DaemonError` carrying it; any other failure rejects with a plain error.
- **`local.start`, `stop`, `restart`, `refresh`** resolve when the command was accepted; the outcome arrives through `subscribe`.
- **`resolveCurrent()`** calls `daemon_resolve_current` and maps its error codes the same way.
- **`switchTo(id)`:**
  - first waits until every `storage.set` already sent has been answered (the storage adapter exposes "settled");
  - then calls `daemon_switch`. On success the page is reloaded, so the promise stays pending; `cancelled` resolves; an error rejects.
  Whether a switch to the current entry is a no-op is decided by the workbench (it knows the connection state), not here.
- **`onManageRequest`** fires on the `daemons_manage` event.
- `ipc.ts` stays the only module that touches Tauri: it gains the event listener.
- Unit tests over a fake `ipc` for every method.

## Out of scope
- Everything the workbench draws (sprint-110). With this task done and sprint-110 not, the window looks as before.

## Acceptance criteria
- [ ] `snapshot()` returns the boot view; after a fake `daemons_changed` it returns the new view and each subscriber was called once; an unsubscribed listener is not called.
- [ ] `add` rejecting with the text `name_taken` yields a `DaemonError` with that code; a transport failure yields a plain error.
- [ ] `switchTo` does not call `daemon_switch` until a pending `storage_set` has been answered.
- [ ] `switchTo` resolves on `cancelled`, rejects on `not_found`, and stays pending on success.
- [ ] `resolveCurrent` returns the intent unchanged, and rejects with `local_stopped` as a `DaemonError`.
- [ ] Outside Tauri the browser host is used and has no `daemons`: `npm run snapshot` still draws the workbench.
- [ ] `npm run check`, `npm run lint`, `npm test` and `cargo xtask web` pass.

## Test / verification plan
- In `desktop/apps/pistudiodesktop`: `npm run check && npm run lint && npm test`
- `npm run build && npm run snapshot -- --out /tmp/ui.png`
- `cargo xtask web` in `desktop/`

## Notes
- Runs in parallel with task-004: the frontend's `src/` against Rust.
- The intent returned by `resolveCurrent` holds a password or a pairing link. It is handed to the workbench and kept nowhere in this module; no log call receives it.
