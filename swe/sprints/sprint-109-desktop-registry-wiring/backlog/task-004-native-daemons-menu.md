# Task 004 — The native "Daemons" menu

- **Sprint:** sprint-109-desktop-registry-wiring
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/shell, desktop/apps/pistudiodesktop/src-tauri
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-003

## Goal
The app has a native "Daemons" menu that lists the entries, marks the current one, switches on a click, opens the Daemons screen, and starts, stops or restarts the local daemon. It is rebuilt whenever the registry or the local state changes.

## Context / why
D14. The app has no native menu of its own today (the sample's commands had menu paths; they are gone). This menu is the first, and its items depend on data, so it cannot come from the static menu paths of the command registry alone.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Public contract 5 (native menu), § Local daemon state (the confirm before stopping), § Switching ("a switch from the native menu follows the same steps")
- `desktop/crates/shell/src/menus.rs` (the menu model generated from the registry; `MENU_ORDER`), `control.rs` (`Request::Invoke`: a menu click), `lib.rs`
- `desktop/apps/pistudiodesktop/src-tauri/src/main.rs`, `bridge.rs`
- `desktop/docs/architecture.md` (menus are generated, never hand-written per platform)

## What to build
- **Menu model in the shell crate**, a pure function of the registry view, tested:
  - one item per entry, in registry order, checked on the current one; the local entry's label carries its state when it is not `running`, for example "This machine (stopped)";
  - a separator, then "Manage Daemons…";
  - a separator, then "Start Local Daemon", "Stop Local Daemon", "Restart Local Daemon", each enabled only where it applies: start in `stopped` and `failed`; stop and restart in `running`; none in `unsupported`, `cli_missing`, `cli_outdated`, `checking`, `starting`, `stopping`.
  The model is part of what `ui.inspect` returns under `menus`.
- **The native menu** built from that model and rebuilt after every `daemons_changed`. On macOS the standard application, Edit and Window menus stay in place: without an Edit menu the copy, paste and select-all shortcuts stop working in the webview.
- **Clicks:**
  - an entry: the current one does nothing; another runs the switch of task-003;
  - "Manage Daemons…": shows and focuses the window and sends the `daemons_manage` event to the page;
  - start, restart: `daemon.local.start` / `.restart`;
  - stop: when the current entry is the local one, a native confirm first ("Agents running on this daemon will stop."); then `daemon.local.stop`.
- A click that the engine refuses (for example `busy`) is logged and shown as a native alert with the reason.

## Out of scope
- Any other menu (File, View, Help): not specified.
- What the page does on `daemons_manage` and on a stop (sprint-110).

## Acceptance criteria
- [ ] The model for (local running, direct B current, relay C) has three entry items in order with only B checked, and "Stop" and "Restart" enabled, "Start" disabled.
- [ ] With the local entry `stopped` its label is "This machine (stopped)" and only "Start" is enabled; with `unsupported` all three are disabled.
- [ ] `ui.inspect` returns the model, and it changes after `daemon.add` over the control socket.
- [ ] With fake services: clicking the current entry runs nothing; clicking another runs the switch once; "Stop" with the local entry current asks first and "no" runs nothing.
- [ ] On Linux, in the WebDriver container, a screenshot of the X display shows the "Daemons" menu with the entries (the full click-through is task-006).
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell`
- `cargo xtask ci` in `desktop/`
- One X-display screenshot of the open menu in the `pi-desktop-xvfb` container.

## Notes
- **Found at planning time:** the spec says choosing the current entry does nothing "when the connection is up". Rust cannot see the page's connection, so from the menu the current entry always does nothing; reconnecting stays with Retry in the connection bar. sprint-111/task-003 records it.
- **Found at planning time:** a custom menu replaces the one Tauri installs by default. macOS depends on that default for the Edit shortcuts, so the standard menus are kept explicitly; the platform checklist verifies it (sprint-111/task-001).
- Depends on task-003 because both edit `main.rs` and this task calls the switch.
- The stop confirm is in the callers (here, and the Daemons screen in sprint-110), not in the engine command: a script using the control socket is not asked.
