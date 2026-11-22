# Task 005 — App binary: `transfer_upload`, `transfer_save`, `transfer_cancel`, the event, and the wiring

- **Sprint:** sprint-122-desktop-transfer-wiring
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src-tauri
- **Priority:** P1
- **Estimated size:** L
- **Depends on:** task-002, task-003, task-004, sprint-121/task-005

## Goal
The page can start, watch and cancel transfers that Rust runs on its own connection to the current entry's daemon.

## Context / why
Everything before this task is tested alone. Here the engine gets the real dial, real files, the page's commands, and the moments it must stop.

## Scope references
- `swe/features/desktop-transfer-engine.md` § 2, § 3 (Who, Dial), § 8 (the log), § Leaving, § The connection and its recovery (what ends a wait), § Error handling (the codes), decisions D10, D19, D20, S5
- `desktop/apps/pistudiodesktop/src-tauri/src/transport.rs` (`try_open`: the plan for the current entry, the password on the blocking pool, `on_window_event`, `on_run_event`, the inspector hook), `transfers.rs` (the page's count, the close question), `commands.rs` (`boot`, `off_thread`), `daemons.rs` (`switch_window`), `resume.rs` (`emit`), `main.rs`
- `desktop/crates/shell/src/owner_access.rs` (`bridge_plan`, `bridge_password`), `desktop/crates/engine/src/local.rs` (`BridgePlan`)
- `src-tauri/src/commands/tests/transport_tests.rs` (how the proxy's command is tested with a local server)

## What to build
- One engine for the app, in Tauri's managed state. Its supplier of sockets: the current entry's plan from the owner thread, the password from the store on the blocking pool, `net::dial` with the 16 MiB limit; each failure classified as final or retryable (a relay entry `not_bridged`; a local daemon that is stopped or starting: retryable).
- `transfer_upload { id, handle, path }`: takes the picked file, reads it off the async runtime's threads; `transfer_save { id, handle, path }`: claims the save and writes through it. Both answer `{ bytes }` when the transfer settled, or `{ code, message }`. `transfer_cancel { id }` answers `{ cancelled }`. `path` is at most 4096 bytes. With the mode `page`: `engine_off`.
- Event `transfer_progress` with the engine's events.
- Leaving: `boot`, a daemon switch (before the reload), the window's destruction and exit cancel every transfer, close the connection and drop the picked files; exit waits no longer than the proxied connections' close does.
- A wake or network signal, and a `transport_open` that succeeded for the same entry, end the engine's wait.
- The `ui.inspect` hook is filled from the engine's snapshot. One log line (info) when a transfer starts, ends or fails: id, kind, daemon path, local path, bytes, duration, code. Never a password or a handle.
- The three commands join the manifest, the capability and `generate_handler!`: 20 commands in all.

## Out of scope
- The page's side (task-006).
- Relay entries.

## Acceptance criteria
- [ ] Against the stand-in daemon (as the proxy's tests use a local server): an upload of a picked file and a save into a claimed save complete with the right bytes, and the progress events were emitted.
- [ ] A handle Rust did not issue, a used one, a bad `id` and a second transfer with a running `id` answer `unknown_handle`, `unknown_handle`, `invalid_request` and `duplicate_id`.
- [ ] `boot` and a switch cancel a running transfer: its command answers `cancelled`, its temporary file is gone, the stand-in saw the connection close.
- [ ] A marker test over the answers, events and captured log lines: a local path appears only in log lines; a password and a handle appear nowhere.
- [ ] The capability list test names exactly 20 commands; `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell -p pistudiodesktop`
- `cargo clippy -p pistudiodesktop-shell -p pistudiodesktop --all-targets -- -D warnings`
- `cargo xtask ci` in `desktop/`

## Notes
- Nothing on the owner thread but the question for the current entry.
- The message of an error may name the daemon's host and its reason, never a local path.
