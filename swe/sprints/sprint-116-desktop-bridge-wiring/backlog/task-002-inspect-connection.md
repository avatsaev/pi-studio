# Task 002 — `ui.inspect`: the proxied connections and the last error

- **Sprint:** sprint-116-desktop-bridge-wiring
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/shell, desktop/apps/pistudiodesktop/src-tauri
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
The control socket shows which proxied connections exist, how much they carried, and the last connection error.

## Context / why
P10. The macOS runner has no WebDriver; this is how an automated check sees that the page connected through Rust. It is also the first thing to look at when a person reports that the app does not connect, since the page itself learns only a close code.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 7
- `desktop/crates/shell/src/control.rs` (`view`), `services.rs`
- `desktop/apps/pistudiodesktop/src-tauri/src/control_server.rs`
- `desktop/docs/control-protocol.md`
- `desktop/crates/shell/tests/secret_guard.rs`

## What to build
- `connection.transports`: for each proxied connection the entry id, the state (`connecting` until the page's upgrade, `open`, `closing`) and the four counters (`framesIn` and `bytesIn` are daemon to page).
- `connection.lastError`: the code and the time of the last failed `transport_open` or abnormal end (`page_refused`, `page_timeout`, `upstream_lost`, `too_large`), or null.
- The shell crate gets the snapshot through a hook the app fills in; it holds no socket type.
- The control protocol document describes the object.

## Out of scope
- Any address, token, local URL, message text or secret in the view.
- The page reading this view.

## Acceptance criteria
- [ ] With a connection open and frames exchanged, `ui.inspect` shows one transport, `open`, with counters above zero; after a close it shows none.
- [ ] After a refused open, `lastError.code` is the error's code; after a client with a wrong token, `page_refused`.
- [ ] The secret guard test passes over the new fields, with a marker token as well as a marker password.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell -p pistudiodesktop`
- `cargo xtask ci` in `desktop/`

## Notes
- `secretStore` and `resumeSignals` are already in `connection` (sprints 113 and 114): add to the object, do not replace it.
