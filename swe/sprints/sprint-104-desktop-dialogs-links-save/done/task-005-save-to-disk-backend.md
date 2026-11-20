# Task 005 — Rust: save-to-disk backend (save dialog, temporary file, finish or discard)

- **Sprint:** sprint-104-desktop-dialogs-links-save
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/shell, desktop/apps/pistudiodesktop/src-tauri
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-004

## Goal
Rust owns the destination of a saved file: it shows the save dialog, takes the bytes in order through an opaque handle, and makes the file appear only when the save finished.

## Context / why
The page must never name a path on the user's machine. It gets a handle valid for one save; the destination comes from the dialog. A failed or abandoned save must leave an existing file untouched and no temporary file behind.

## Scope references
- `swe/features/desktop-native-host.md` § Save to disk, § Error handling (save rows, "the app quits during a save"), § Public contract 5 ("Tauri commands for the page")
- `desktop/crates/shell/src/` (`services.rs`, a new module for the save state), `desktop/crates/store` (atomic write, remove: for the journal)
- `desktop/apps/pistudiodesktop/src-tauri/src/` (`main.rs`, page commands, `services.rs`), `build.rs`, `capabilities/default.json`

## What to build
- **Save state in the shell crate**, tested with a temporary directory:
  - begin(destination) creates a temporary file beside the destination and returns a handle: 128 random bits, hex, single use. At most 8 saves open at once;
  - write(handle, bytes) appends; at most 16 MiB per call;
  - finish(handle) flushes to disk, then renames the temporary file over the destination;
  - discard(handle) removes the temporary file;
  - an unknown, finished or discarded handle is an error.
- **Journal:** the temporary files of open saves are listed in `pending-saves.json` in the configuration directory. At launch every listed file is removed and the journal emptied.
- **Service hook:** pick a save path (suggested name, starting folder) → a path, or nothing when cancelled. Native implementation with the dialog plug-in. The starting folder is the one used last in this run of the app, else the user's Downloads folder.
- **Suggested name** comes from the page, so Rust reduces it to a file name: no directory part, no control characters, at most 255 bytes, `download` when nothing is left.
- **Page commands**, added to the command list and the capability file:
  | Command | Input | Answer |
  |---|---|---|
  | `save_begin` | `{ suggestedName }` | `{ handle }`, or null when the dialog was cancelled |
  | `save_write` | the handle and the bytes as a raw binary body | nothing, once written |
  | `save_finish` | `{ handle }` | nothing |
  | `save_discard` | `{ handle }` | nothing |
- File writes do not run on the thread that owns the session.

## Out of scope
- The frontend target and the transfer count (task-007).
- Remembering the last folder across runs (the settings file has no field for it).

## Acceptance criteria
- [ ] begin, three writes, finish: the destination holds the bytes in order and the directory holds no temporary file.
- [ ] With an existing destination, its content is unchanged until finish, and unchanged after a discard.
- [ ] A write after finish, a second finish, and an unknown handle are errors.
- [ ] A 16 MiB + 1 byte write and a ninth open save are refused.
- [ ] `../../x`, `a/b.txt`, a name with a newline and the empty string become `x`, `b.txt`, a name without the newline and `download`.
- [ ] A temporary file listed in the journal is removed at the next launch and the journal is empty afterwards.
- [ ] The four commands are the only additions to the capability file; `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell`
- `cargo xtask ci` in `desktop/`
- The dialog and a real 1 GiB save are observed in task-008.

## Notes
- Send chunk bytes as a raw request body, not as a JSON array of numbers.
- The destination may be on another volume than the configuration directory; the temporary file is beside the destination so the final rename stays on one volume.
- **Found at planning time:** the spec says "the folder used last" without saying where it is kept. It is kept in memory for the run; persisting it needs a settings field and is not planned.
