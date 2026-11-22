# Task 002 — The native open dialog and `upload_pick` (D3, D20)

- **Sprint:** sprint-122-desktop-transfer-wiring
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/shell, desktop/apps/pistudiodesktop/src-tauri
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
The page can ask for files to upload and gets handles, names and sizes; the paths stay in Rust.

## Context / why
Rust needs a real path to read a file itself. The page must never be able to name one (D20). The app has never shown an open dialog.

## Scope references
- `swe/features/desktop-transfer-engine.md` § 2 (`upload_pick`), decisions D3, D20, § TODO(verify) (the native open dialog)
- `desktop/crates/shell/src/services.rs` (the hooks, `pick_save_path`), `saves.rs` (`choose`, `random_hex`, `file_name`), `desktop/apps/pistudiodesktop/src-tauri/src/services.rs` (`Native::pick_save_path`, the one-at-a-time lock)
- `src-tauri/src/commands.rs` (the header: how a command is permitted), `build.rs`, `capabilities/default.json`, `commands/tests.rs` (the exact capability list)
- `desktop/docs/architecture.md` (§ The webview boundary, the command table)

## What to build
- A hook in `Services` for "pick files to open" (several), implemented in the app with the dialog plug-in, off the event loop, one dialog at a time, starting in the folder used last in this run.
- A table of picked files in `shell`: handle (128 random bits, 32 hexadecimal digits) to path; at most 1024 unused entries (the oldest is dropped); an entry is taken once; all are dropped at `boot`.
- Command `upload_pick`: answers `[{ handle, name, size? }]` (`name`: the last path component, lossy if it is not valid Unicode; `size` when the metadata could be read) or `[]` when the user cancelled; `engine_off` when the mode is `page`.
- The command joins the manifest, the capability and `generate_handler!`; the capability list test grows by one.

## Out of scope
- Reading the file (task-005).
- A folder picker; native drops.

## Acceptance criteria
- [ ] With a fake hook returning three paths: three entries with the right names and sizes; a handle is 32 hexadecimal digits; no answer holds a path.
- [ ] A handle can be taken once; the 1025th unused entry drops the oldest; `boot` drops all.
- [ ] With `--transfers page` the command answers `engine_off` and no dialog is shown.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell -p pistudiodesktop`
- `cargo clippy -p pistudiodesktop-shell -p pistudiodesktop --all-targets -- -D warnings`
- `cargo xtask ci` in `desktop/`

## Notes
- The dialog itself is seen in task-007 (Linux) and sprint 123 (macOS, Windows).
- `commands.rs`, `build.rs` and the capability file are also edited by task-005: this task lands first.
