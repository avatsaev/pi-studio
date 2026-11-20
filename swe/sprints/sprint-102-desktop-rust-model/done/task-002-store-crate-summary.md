# Task 002 — `store` crate — Summary
- **Sprint:** sprints/sprint-102-desktop-rust-model
- **Completed:** 2026-11-20
- **Status:** done

## What was implemented
New crate `pistudiodesktop-store` (layer 3). It is native-only: `lib.rs` carries `#![cfg(not(target_arch = "wasm32"))]`, so on wasm32 the crate is empty. It has no document type of its own.

- **`read(path, decode) -> Loaded<T>`**
  - `decode` is a caller-supplied `FnOnce(&[u8]) -> Option<T>`.
  - `Loaded::Missing` means the file is absent, and nothing is created.
  - `Loaded::Value(T)` means the file was read and decoded.
  - `Loaded::Reset { kept_as: Option<String> }` means the file could not be read, is not a regular file (a directory is set aside; a pipe is never opened), is over `MAX_BYTES` (32 MiB), or the decoder refused it.
    - It is renamed to `<name>.corrupt-<YYYYMMDDTHHMMSSZ>`, with `-1`, `-2`… appended if that name is taken, so two resets in one second keep two files. `kept_as` is the new file name.
    - If the rename fails, or no free name is found within 1,000 tries, the answer is still `Reset` with `kept_as: None`, and it is logged.
    - Size is checked from metadata before opening, and the read is also capped with `take(MAX_BYTES + 1)`.
- **`write_atomic(path, bytes) -> io::Result<()>`**
  - It creates missing parent directories, writes a `tempfile::NamedTempFile` in the destination's directory, calls `sync_all`, and persists it over the destination.
  - On any failure the destination is untouched and the temp file removes itself on drop.
- **`remove(path)`** treats a missing file as success.
- **Logging:** log lines use only the file name (`log_name`), never the directory or the content.
- **Timestamp:** `stamp.rs` builds the UTC timestamp itself, so there is no date-time dependency.

## Files created / changed
| File | Change |
|---|---|
| `desktop/crates/store/Cargo.toml` | New. `log` and `tempfile` are native-only dependencies; `tempfile` is also a dev-dependency. |
| `desktop/crates/store/src/lib.rs` | New. Crate docs, the wasm cfg, re-exports and `log_name`. |
| `desktop/crates/store/src/read.rs` | New. `read`, `Loaded`, `MAX_BYTES`, `set_aside`, plus 11 tests. |
| `desktop/crates/store/src/write.rs` | New. `write_atomic` and `remove`, plus 5 tests. |
| `desktop/crates/store/src/stamp.rs` | New. `utc_stamp`, plus 2 tests. |
| `desktop/Cargo.toml` | Added the `pistudiodesktop-store` workspace dependency and `tempfile = "3"` under external dependencies. |
| `desktop/Cargo.lock` | Added the store package entry. |
| `desktop/xtask/src/layers.rs` | Added the row `("store", Class::Layer(3))`. |

The `model` lines already in `Cargo.toml`, `Cargo.lock` and `layers.rs` (the workspace dependency line, the `Cargo.lock` package entry, the table row and the L1 comment) came from task-001; I did not touch them. `tempfile` was already in the lockfile, so no new package was added.

## How it satisfies the scope
Each acceptance criterion has a matching test; see the list below.

## Build & test results
All run in `desktop/`:
- `cargo test -p pistudiodesktop-store`: 18 passed.
- `cargo clippy -p pistudiodesktop-store --all-targets -- -D warnings`: clean.
- `cargo fmt --check -p pistudiodesktop-store`: clean.
- `cargo xtask layers`: `pistudiodesktop-store L3`, "layering: ok (11 crates)".
- `cargo xtask wasm`: passes, with store included.

## Acceptance criteria
- [x] Reading a missing file answers "missing" and creates nothing (`a_missing_file_is_missing_and_creates_nothing`, `a_missing_directory_is_missing_too`).
- [x] Garbage answers "reset": the bytes are kept in a `*.corrupt-*` file and the original name is free (`garbage_is_set_aside_with_its_bytes_and_the_name_is_free`).
- [x] Two resets within one second produce two different kept files (`two_resets_in_one_second_keep_two_files`, using a fixed timestamp, and `two_real_resets_in_a_row_keep_two_files`).
- [x] An atomic write replaces an existing file, creates missing directories, and leaves no temp file (`replaces_an_existing_file_and_leaves_no_temporary_file`, `creates_missing_directories`, `a_failed_rename_leaves_the_destination_and_no_temporary_file`).
- [x] A write whose directory cannot be created returns an error and changes nothing (`a_directory_that_cannot_be_created_is_an_error_and_changes_nothing`).
- [x] Removing a missing file is not an error (`removing_a_missing_file_is_not_an_error`).
- [x] `cargo xtask layers` lists the crate at L3 and `cargo xtask wasm` passes (both run).

Further tests cover the size cap (a file over 32 MiB is never decoded; a file exactly at the cap is), a directory in place of the file, the failed-rename path (`kept_as: None`), and a path with no file name.

## Follow-ups / TODO(verify)
- `tempfile::NamedTempFile` creates the file with mode 0600, so a rewrite replaces whatever mode the old file had. This is the registry/mode question the task says not to solve here.
- The no-clobber check for a set-aside name is exists-then-rename. It is race-free only because the app is the only writer of its files (a comment in the code says so).
- The parent directory is not fsynced after the rename. The task only asks to flush the file.
- `engine` still declares `tempfile = "3"` directly instead of `{ workspace = true }`. I left it because it is outside my files; the task that deletes the sample engine code will remove it.

## Proposed doc edits for the orchestrator
- `desktop/AGENTS.md` workspace map: add `crates/store   L3  the app's JSON files: read with set-aside, atomic write, remove (native only)`.
- `desktop/docs/architecture.md`: add the crate if it lists crates.
- Task file: tick the acceptance boxes; sprint notes can mention that `read` takes a decoder returning `Option<T>` and answers `Loaded::{Missing, Value, Reset { kept_as }}`.

## Wave gate (orchestrator)
```
cargo fmt --check; clippy --workspace -D warnings; cargo test --workspace (21 result lines ok, no failures); xtask layers ok (11 crates); xtask wasm ok. Desktop doc edits deferred to sprint-102/task-005.
```
