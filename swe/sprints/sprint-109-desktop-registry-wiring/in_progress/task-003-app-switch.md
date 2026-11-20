# Task 003 — App: switching to another daemon entry

- **Sprint:** sprint-109-desktop-registry-wiring
- **Status:** in_progress
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src-tauri, desktop/crates/shell
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002

## Goal
One Rust path switches the window to another entry: it asks first when file transfers are running, makes sure stored state is on disk, records the entry as last used, and reloads the page so the workbench boots on the new entry.

## Context / why
D16, D25. Every workbench store holds one daemon's data and was written for one connection per page. Reloading the page is what guarantees none of it crosses to another daemon, and that the new entry's stored layout is in place before the first render.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Switching, § Public contract 3 (`switchTo`), § Error handling (unreachable entry at launch)
- `swe/features/desktop-native-host.md` § Transfers in flight (the count reported by the page; the close confirm of sprint-104/task-007)
- `desktop/crates/shell` (the close decision of sprint-104/task-007: the same count, a sibling pure function), `desktop/crates/engine` (`daemon.switch`: sprint-107/task-003)
- `desktop/apps/pistudiodesktop/src-tauri/src/` (`main.rs`, page commands), `build.rs`, `capabilities/default.json`

## What to build
- **The switch**, as one function used by the page command here and by the native menu (task-004):
  1. the id is unknown: error `not_found`, nothing happens;
  2. transfers are running (count above zero): a native confirm "N file transfer(s) are still running. Switch anyway?"; "no" ends here and reports "cancelled";
  3. run `daemon.switch` (which flushes the entry being left, records `lastUsedId` and writes the registry);
  4. reload the window's page. `boot` then returns the new entry's storage and view, and resets the transfer count.
- The decision of steps 1–2 and the confirm's text are a pure function with tests.
- **Page command** `daemon_switch { id }`, added to the command list and the capability file. It answers `cancelled` or an error; on success the page is reloaded and no answer is expected.
- Whether to switch at all when the id is already current is the caller's question: the page knows whether its connection is up (sprint-109/task-005), the menu applies its own rule (task-004).

## Out of scope
- The menu (task-004). The frontend's `switchTo`, which first waits for its own pending storage writes (task-005).
- Stopping or starting any daemon: a switch never does either. Opening the local entry may start its daemon, but that happens in `daemon_resolve_current` after the reload.

## Acceptance criteria
- [ ] The decision function: unknown id → `not_found`; count 0 → switch; count 2 → ask, with "2" in the text.
- [ ] With fake services: answering "no" leaves `lastUsedId`, the page and the count untouched; answering "yes" switches.
- [ ] After a switch from `local` to entry B, `<tmp>/daemons.json` has `lastUsedId` B, the layout stored while on `local` is in `daemon-state/local.json`, and the next `boot` returns B's stored keys.
- [ ] `daemon_switch` is the only addition to the capability file.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell`
- `cargo xtask ci` in `desktop/`
- The reload itself is observed in task-006.

## Notes
- A storage write the page had not yet sent when a menu switch reloads it is lost. It is the same open question as a layout change just before closing (native-host spec TODO on `pagehide`, checked in sprint-103/task-004); the page-initiated path avoids it by waiting first (task-005).
- The confirm must not block the session's thread (as for every dialog since sprint-104/task-004).
