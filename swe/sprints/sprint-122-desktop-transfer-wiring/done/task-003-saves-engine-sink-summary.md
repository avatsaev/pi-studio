# Task 003 — `Saves`: the engine's sink, and one save per destination — Summary

- **Sprint:** sprints/sprint-122-desktop-transfer-wiring
- **Status:** done. Gates passed with one unrelated test failure (below).

## What was implemented
- `Saves::claim(self: &Arc<Self>, handle) -> Result<ClaimedSave, SaveError>` hands an open save to the engine.
  - The save keeps its temporary file, its place against `MAX_OPEN` and its line in the journal. The launch cleanup removes it after a crash.
  - The page's `write`, `finish` and `discard` answer `UnknownHandle` for a claimed handle. A second `claim` of the same handle also answers `UnknownHandle`.
  - A claim on a destination that another claimed save is writing answers the new `SaveError::DestinationBusy`. The save being claimed is discarded: no file is left, its handle is spent, and the journal is rewritten.
- `ClaimedSave` offers these calls:
  - `write(&self, &[u8])` adds to a running count. It is not limited by `MAX_WRITE_BYTES`; the engine holds its own bytes.
  - `written() -> u64` returns the bytes written so far.
  - `finish(self)` flushes and renames over the destination.
  - `discard(self)` removes the temporary file.
  - Dropping a `ClaimedSave` unfinished discards it.
- After finish, discard or drop, the destination is free again; the claim is released after the rename.
- Two spellings of one file count as the same destination: `destination_key` resolves the folder's links and appends the file name. A page save into a claimed destination is not refused until it is itself claimed.
- `shell` does not depend on `transfer`. The module doc header is updated; no other docs name this API.

## Files created / changed
| File | Change |
|------|--------|
| `desktop/crates/shell/src/saves.rs` | modified: `claim`, `ClaimedSave`, `SaveError::DestinationBusy`, `State.claimed`, `destination_key`; `get` refuses claimed handles; `forget` releases the claim |
| `desktop/crates/shell/src/saves/tests.rs` | added 10 tests |

## Build & test results
```
$ cargo test -p pistudiodesktop-shell
193 passed, 1 failed. The failure is process::tests::output_is_returned_and_environment_is_not_inherited
(process.rs:169, Err(CouldNotStart)), a file this task does not touch.

$ cargo test -p pistudiodesktop-shell saves
30 passed, 0 failed   (10 new claim tests)

$ cargo clippy -p pistudiodesktop-shell --all-targets -- -D warnings
clean

$ cargo fmt -p pistudiodesktop-shell -- --check
ok

$ cargo xtask wasm
ok

$ cargo check -p pistudiodesktop --all-targets
ok (no call sites broken)
```

## Acceptance criteria
- [x] Claim, write in several pieces, finish: the destination holds the bytes, the temporary file is gone and the journal is empty. Test: `a_claimed_save_takes_pieces_counts_them_and_finish_leaves_the_bytes_and_nothing_else`.
- [x] Claim, write, discard, and claim, write, drop: no temporary file, and an existing destination is untouched. Test: `a_discarded_or_dropped_claimed_save_leaves_no_temporary_file_and_the_destination_alone`.
- [x] A second claim on the same destination is `destination_busy` and leaves no file; after the first finishes, a new save to it works. Test: `a_second_claim_on_one_destination_is_busy_discards_that_save_and_a_new_save_works_after_the_first_ends`.
- [x] The page's three commands refuse a claimed handle. Test: `the_page_cannot_use_a_claimed_handle`.
- [x] A claimed save counts against `MAX_OPEN` and is cleaned up after a crash. Tests: `a_claimed_save_still_counts_against_the_open_limit_until_it_ends`, `a_claimed_save_is_removed_at_the_next_launch_after_a_crash`.
- [ ] `cargo xtask ci` was not run, because it is the whole-repo gate and the brief limited me to narrow gates.

## Follow-ups / TODO(verify)
- `process::tests::output_is_returned_and_environment_is_not_inherited` fails with `CouldNotStart`. I did not touch `process.rs` or look into the cause. It may be this environment; the orchestrator should check it before `cargo xtask ci`.
- Task 005 maps `SaveError::DestinationBusy` to the page code `destination_busy` and `UnknownHandle` to `unknown_handle`. Its sink implementation can wrap `ClaimedSave` directly.
- Destination matching is by exact file name, so a case-insensitive file system could treat `A.txt` and `a.txt` as different. I did not handle that.

## Wave gate (orchestrator, combined tree)
```
npm run build -> ok; npm run typecheck -> ok; npm run lint -> 0 errors; npm test -> 295 files, 4204 tests passed
(first run: 2 failures in packages/workbench/src/host/files.test.ts, caused by sprint-119/task-002 removing the setStatus dep; the tests were moved onto the activity store and the gate re-run)
cargo xtask ci (desktop/) -> all 8 steps passed, including shell's process tests
```
