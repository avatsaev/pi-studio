# Task 007 — Save through Rust in the desktop host, and a confirm before closing during a transfer

- **Sprint:** sprint-104-desktop-dialogs-links-save
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src/host, desktop/apps/pistudiodesktop/src-tauri, desktop/crates/shell
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-003, task-005, task-006

## Goal
"Download" in the app window opens a native save dialog and writes the file through Rust, and closing the window while a transfer runs asks first.

## Context / why
The workbench can now stream a save into a target (task-003) and Rust can receive one (task-005); this task joins them. D25: a close or quit that would cut a transfer short must not be silent.

## Scope references
- `swe/features/desktop-native-host.md` § Save to disk, § Transfers in flight, § Public contract 2 (rows `files.saveToDisk`, `files.upload`)
- `desktop/apps/pistudiodesktop/src/host/` (`desktop-host.ts`, `ipc.ts`)
- `packages/workbench/src/host/browser-host.ts` (`saveTarget` option, `SaveTarget`: task-003)
- `desktop/apps/pistudiodesktop/src-tauri/src/` (`main.rs`, page commands), `build.rs`, `capabilities/default.json`; `desktop/crates/shell` (the close decision as a pure function)

## What to build
- **Save target over `ipc`:** `saveTarget(suggestedName)` calls `save_begin` (null → null); `write` sends the chunk as raw bytes and resolves when Rust answered; `finish` and `discard` call their commands. Passed to `createBrowserHost({ saveTarget })`.
- **Transfer count:** the desktop host wraps `files.upload` and `files.saveToDisk`, counts the calls that have not settled, and reports each change to Rust through a new page command `transfers_set { count }` (added to the command list and the capability file). `boot` resets the count to zero, so a reloaded page does not leave a stale number.
- **Close request in Rust:** with a count above zero, show the native confirm "N file transfer(s) are still running. Quit anyway?"; "no" keeps the window open. With zero, close as today. The decision and the text are a pure function with tests.

## Out of scope
- The confirm when switching daemons (registry plan; it reads the same count).
- Anything about running agents: quitting never asks about them and never stops a daemon (D4).

## Acceptance criteria
- [ ] Over a fake `ipc`: a cancelled dialog yields a null target; writes are sent in order and each waits for its answer; `finish` and `discard` reach Rust once.
- [ ] The count goes up when an upload or a save starts and down when it resolves or rejects; two overlapping transfers report 1, 2, 1, 0.
- [ ] The close decision returns "ask" with the right number for 1 and 3, and "close" for 0.
- [ ] `transfers_set` is the only addition to the capability file.
- [ ] `npm run check`, `npm run lint`, `npm test` and `cargo xtask ci` pass.

## Test / verification plan
- In `desktop/apps/pistudiodesktop`: `npm run check && npm run lint && npm test`
- `cargo test -p pistudiodesktop-shell`; `cargo xtask ci` in `desktop/`
- The real save and the close confirm are observed in task-008.

## Notes
- `files.upload` and `files.openForView` stay the browser host's (milestone 3 moves them).
- The count is a hint from the page, not a security boundary: a wrong number can only cause or skip a question.
