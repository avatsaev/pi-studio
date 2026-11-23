# Task 001 — The setting, the update state machine, the schedule and the `Services` hook

- **Sprint:** sprints/sprint-132-desktop-update-app
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/model, desktop/crates/shell
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** none

## Goal
The update state of spec § 4 and its transitions live in the shell, driven by a `Services` hook a
test can fake; the schedule of P16 runs on an injected clock; `checkForUpdates` exists.

## Context / why
Spec § 4, § Behavior (The app), P9, P14, P16, U9, U12, U13. Rule 4: the shell stays free of Tauri.

## Scope references
- `swe/features/desktop-self-update.md` § 4, § 7, § Behavior & algorithms (The app), § Error handling
- `desktop/crates/model/src/lib.rs` (`Settings`: `checkForUpdates`, absent = true)
- `desktop/crates/shell/src/services.rs` (new hook, like `remote_run`), new `crates/shell/src/update.rs`
  (+ tests), `crates/shell/src/resume.rs` (the wake signal)

## What to build
- `Settings.check_for_updates` (serde `checkForUpdates`, default true), settable through `settings.set`.
- `UpdateState` (the eight variants, reasons and codes of the spec) with JSON for `boot`/events.
- An `UpdaterHook` in `Services`: `check(manifest) -> Found{version, release_url} | UpToDate | Err(code)`,
  `install_kind() -> Kind`, `cannot_install(kind, version) -> Option<reason>`, `download(progress) ->
  Result<(), code>`, `install() -> Result<(), code>`, `restart()`. Async boundaries as the existing
  hooks do them (never on the owner thread).
- Transitions: automatic vs manual origin (silent failure for automatic), P14 (no check in
  `restart_needed`), `downloading` refuses checks.
- Schedule: at launch; hourly tick with a 24 h rule; the wake signal with the same rule; all off when
  the setting is false; manual always allowed.
- A change notification the app turns into the `update_changed` event (callback in the shell, like
  `daemons_changed`).

## Out of scope
Commands and menus (task-002); the real plug-in (task-003, task-004).

## Acceptance criteria
- [ ] Unit tests: every transition of § Behavior, each code and reason, P14, P16 on a fake clock
  (launch, 23 h, 24 h, wake after 3 days, setting off), automatic failure silent vs manual `failed`.
- [ ] `checkForUpdates` absent reads true; round-trip keeps unknown keys.
- [ ] `cargo xtask ci` passes (including wasm).

## Test / verification plan
- `cd desktop && cargo test -p pistudiodesktop-shell update && cargo xtask ci`
