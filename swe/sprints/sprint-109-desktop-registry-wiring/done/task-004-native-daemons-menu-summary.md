# Task 004 — The native "Daemons" menu — Summary

**Sprint:** sprint-109-desktop-registry-wiring · **Completed:** 2026-11-20 · **Status:** implemented, with the X-display screenshot not taken and `cargo xtask ci` stopped at its `web` step. The `web` failure is in the sibling's frontend files, and I did not run `panic_hunt` or the doctests.

## What was implemented
- **Menu model** (`crates/shell/src/menus.rs`):
  - `daemons_menu(view)` is a pure function of the registry view.
  - It lists one item per entry in registry order, checked on the current one.
  - The local entry's label carries its state when it is not `running`, e.g. "This machine (stopped)".
  - After a separator comes "Manage Daemons…", then another separator, then Start, Stop and Restart Local Daemon.
  - Start is enabled only in `stopped` and `failed`; Stop and Restart only in `running`.
  - `model()` now takes `&mut AppShell`, puts the Daemons menu first and keeps the command-registry loop. `ui.inspect` returns this under `menus`.
  - `MenuItem` and `Menu` now use `String` fields and gained `checked` and `separator`.
- **Clicks**:
  - `click_of(id)` maps an item id to a `Click`, and `handle_click(services, access, click, switch, manage)` carries it out. `handle_click` is native-only (`cfg(not(wasm32))`).
  - The current entry does nothing. Another entry runs the `switch` closure once.
  - Stop asks "Agents running on this daemon will stop." only when the current entry is `local`; if you decline, nothing runs.
  - Start and Restart run the engine commands directly.
  - A refusal from the engine or the switch is shown as a native alert with the reason.
- **Native menu** (`src-tauri/src/menu.rs`, new):
  - It builds the bar with Tauri menus. Entries are check items.
  - On macOS it keeps the standard App, Edit and Window menus.
  - `rebuild(handle, view)` runs on the main thread and is called from `Events::to_page` after each `daemons_changed`. `install` draws the first bar from `daemon.list`.
  - `on_event` handles clicks on a separate thread. A switch goes through `daemons::switch_window`. "Manage Daemons…" calls `bring_forward` and emits the `daemons_manage` event.
  - `main.rs` registers the module, `.on_menu_event(menu::on_event)` and `menu::install`.

## Files
- `desktop/crates/shell/src/menus.rs`
- `desktop/crates/shell/src/tests.rs` (updated: the menu is no longer empty, and the model follows `daemon.add`)
- `desktop/apps/pistudiodesktop/src-tauri/src/menu.rs` (new)
- `desktop/apps/pistudiodesktop/src-tauri/src/main.rs`
- `desktop/apps/pistudiodesktop/src-tauri/src/daemons.rs`

## Build & test results
- `cargo fmt` is clean, and `cargo clippy --workspace --all-targets -D warnings` passes.
- `cargo test --workspace` passes, with 140 tests in the shell crate. `cargo xtask layers` and `cargo xtask wasm` pass.
- `cargo xtask ci` passes `fmt` and fails at `web`: 2 vitest failures in the sibling's files (`src/host/boot.ts` and `daemons-view.ts` are modified or new). The later ci steps did not run. I ran `clippy`, `test`, `layers` and `wasm` by hand; `panic_hunt` and the doctests were not run.

## Acceptance criteria
- [x] The model for (local running, B current, relay C) has three entry items in order with only B checked, Stop and Restart enabled, and Start disabled (unit test). The task text says "direct B current"; the test's entry B is `direct` and the third entry C is `relay`.
- [x] A `stopped` local entry shows "This machine (stopped)" with only Start enabled; with `unsupported` all three are disabled (unit test). I also tested `failed`, `cli_missing`, `cli_outdated`, `checking`, `starting` and `stopping`.
- [x] `ui.inspect` returns the model, and it changes after `daemon.add` (shell `tests.rs`).
- [x] With fake services, the current entry runs nothing, another entry switches once, Stop asks first and "no" runs nothing (unit tests).
- [ ] The Linux X-display screenshot was not taken. Neither Xvfb nor the `pi-desktop-xvfb` container was available to me; that is for task-006 / Main to do.
- [ ] `cargo xtask ci` has not passed: it stops at `web` because of the sibling's frontend tests.

## Follow-ups
- Take the X-display screenshot in the `pi-desktop-xvfb` container.
- Menu tooltips are not drawn: Tauri's native items have none, so the `reason` field is only in the model.
- A pre-existing stray doc comment sits above `switch_window` in `src-tauri/src/daemons.rs`; it was the sibling's, so I left it.

## Proposed doc edits
- **`desktop/AGENTS.md` and `desktop/docs/architecture.md`:** the "Daemons" menu is generated from the registry view by `menus::daemons_menu`. `src-tauri/src/menu.rs` draws it and rebuilds it after each `daemons_changed`. On macOS the App, Edit and Window menus are explicit.
- **Same files:** `ui.inspect.menus[0]` is the Daemons menu. The page is sent `daemons_manage` when "Manage Daemons…" is chosen. The stop confirm is in the menu caller, not the engine.
- **Same files:** clicking the current entry does nothing, because Rust cannot see the page's connection.

## Wave gate (orchestrator)
```
Orchestrator: cargo xtask ci (8 steps) passed after task-005 landed. X-display screenshot deferred to task-006.
```
