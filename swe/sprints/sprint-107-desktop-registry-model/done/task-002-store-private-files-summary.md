# Task 002 — Store: private files — Summary
- **Sprint:** sprint-107-desktop-registry-model
- **Completed:** 2026-11-20
- **Status:** done

## What was implemented
- `write_private(path, bytes)` in `desktop/crates/store/src/write.rs`. It shares one `write_with` helper with `write_atomic`.
- On Unix the temporary file is created with mode 0600 through `tempfile::Builder::permissions`. The mode is correct from creation, and the rename leaves a replaced file at 0600.
- On non-Unix, `write_private` behaves like `write_atomic`.
- `write_atomic` is unchanged: it still uses `NamedTempFile::new_in`.
- The corrupt set-aside needed no code change. It uses `rename`, which keeps the mode.
- `write_private` is exported from `lib.rs`.

## Files changed
| File | Change |
|---|---|
| `desktop/crates/store/src/write.rs` | `write_private`, `write_with`, `create_temp`, and mode tests |
| `desktop/crates/store/src/read.rs` | Test that a private file set aside as corrupt stays 0600 |
| `desktop/crates/store/src/lib.rs` | Export `write_private` |

No dependency or `Cargo.toml` changes.

## Build & test
- `cargo test -p pistudiodesktop-store`: 21 passed.
- `cargo clippy -p pistudiodesktop-store --all-targets -- -D warnings`: clean.
- `cargo fmt -p pistudiodesktop-store`: run.
- `cargo xtask ci`: all 8 steps passed, including wasm.

## Acceptance criteria
- [x] Private write of a new file gives 0600 (`a_private_write_of_a_new_file_is_0600`).
- [x] Private write over a 0644 file leaves 0600 (`a_private_write_over_a_looser_file_leaves_0600`).
- [x] A private file set aside as corrupt is still 0600 (`a_private_file_set_aside_as_corrupt_stays_0600`).
- [x] The normal write is unchanged and the existing tests pass.
- [x] The wasm check passes via `cargo xtask ci`. I did not run `cargo xtask wasm` as a separate command.

## Follow-ups
- Nothing was run on Windows. The `#[cfg(not(unix))]` branch is only compiled in the wasm32 check, where the crate is empty.

## Proposed doc edits
- Store crate section: "`write_private(path, bytes)` is the atomic write with the temporary file created at mode 0600 on Unix, so the file is never readable by others. It behaves as `write_atomic` on Windows. A corrupt file set aside by `read` keeps its mode."

## Wave gate (orchestrator)
```
Agent-run cargo xtask ci (8 steps) passed; orchestrator re-gates at the s107 wave end.
```
