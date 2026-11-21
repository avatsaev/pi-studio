# Task 007 — Save through Rust in the desktop host, and a confirm before closing during a transfer — Summary

**Sprint:** sprint-104-desktop-dialogs-links-save · **Status:** implemented, all gates green. I did not move the task file.

## What was implemented
- **Save target over `ipc`** (`src/host/transfers.ts`):
  - `createSaveTarget(ipc)` calls `save_begin`. A null answer gives a null target.
  - `write` sends the chunk as a raw body with the `handle` header and resolves when Rust answers. `finish` and `discard` call their commands once.
  - It is passed to `createBrowserHost({ saveTarget })` in `desktop-host.ts`.
- **`Ipc.invoke`** now takes `Record | Uint8Array` as args and an optional `{ headers }`. `tauriIpc` passes both through to Tauri.
- **Transfer count:** `countTransfers` wraps `files.upload` and `files.saveToDisk`. It reports a new count on every start and every settle, resolve or reject. Each report calls the new `transfers_set { count }` command.
- **`transfers_set`:** added to `build.rs`, the capability file (`allow-transfers-set`), `generate_handler!` in `main.rs`, and the mock app in the command tests. `boot` now resets the count to 0.
- **Close request:**
  - New `src-tauri/src/transfers.rs` holds `Transfers` (an atomic count, managed) and `on_window_event`.
  - On `CloseRequested` with a count above zero it prevents the close and shows the native confirm off the event loop. A yes destroys the window. A no leaves it open.
  - The decision is a pure function in `shell/page.rs`: `close_decision(n)` returns `Close` for 0, or `Ask("N file transfer(s) are still running. Quit anyway?")`. It says "1 file transfer is" and "N file transfers are".
- The close confirm covers window close only. I did not add an `ExitRequested` hook for other quit paths (for example Cmd+Q).

## Files
- `desktop/crates/shell/src/page.rs`
- `desktop/apps/pistudiodesktop/src-tauri/build.rs`
- `desktop/apps/pistudiodesktop/src-tauri/capabilities/default.json`
- `desktop/apps/pistudiodesktop/src-tauri/src/commands.rs`
- `desktop/apps/pistudiodesktop/src-tauri/src/commands/tests.rs`
- `desktop/apps/pistudiodesktop/src-tauri/src/main.rs`
- `desktop/apps/pistudiodesktop/src-tauri/src/transfers.rs` (new)
- `desktop/apps/pistudiodesktop/src/host/ipc.ts`
- `desktop/apps/pistudiodesktop/src/host/desktop-host.ts`
- `desktop/apps/pistudiodesktop/src/host/transfers.ts` (new)
- `desktop/apps/pistudiodesktop/src/host/transfers.test.ts` (new)

I ran `cargo fmt --all`, which may have reformatted files a sibling owns.

## Build & test results
- In `desktop/apps/pistudiodesktop`: `npm run check`, `npm run lint` and `npm test` pass (27 tests).
- In `desktop/`: `cargo xtask ci` passes all 8 steps (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm).
- `npx oxfmt apps/pistudiodesktop/src/host` reported "Expected at least one target file", so those files were not run through oxfmt.

## Acceptance criteria
- [x] **Fake `ipc` behaviour:** `transfers.test.ts` covers a null target on a cancelled dialog, ordered writes where each waits for its answer, and one `finish` or `discard`.
- [x] **Count:** `transfers.test.ts` shows an upload overlapping a save reports `[1, 2, 1, 0]`, and a rejection counts down too.
- [x] **Close decision:** the `page.rs` test asserts `Close` for 0 and `Ask` with the right text for 1 and 3.
- [x] **Capability file:** the only change is `allow-transfers-set`. The command test asserts the exact list, and a new command test checks `transfers_set` stores the count, `boot` resets it, and bad arguments are errors.
- [x] **Gates:** the five commands above pass.

## Follow-ups / TODO(verify)
- The real save and the close confirm are for task-008 to observe. No test shows the dialog or destroys a window.
- The count is a page hint only, as the task notes.

## Proposed doc edits
- **`desktop/AGENTS.md`:**
  - The page now has ten commands. Add `transfers_set { count }`. `boot` resets the count.
  - Add `src-tauri/src/transfers.rs`: `Transfers` state plus the close-confirm window handler.
  - Add `src/host/transfers.ts`: `createSaveTarget` and `countTransfers`.
  - Add `page::close_decision` / `CloseDecision` in the shell.
- **`swe/features/desktop-native-host.md`:** record the close text "N file transfer(s) are still running. Quit anyway?" under § Transfers in flight.

## Wave gate (orchestrator)
```
Agent-run cargo xtask ci (8 steps) + frontend check/lint/test (27) passed; re-gated at the wave end.
```
