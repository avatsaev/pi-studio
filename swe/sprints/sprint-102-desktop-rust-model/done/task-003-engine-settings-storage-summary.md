# Task 003 — Engine: settings and workbench storage in `Session`, `settings.get` / `settings.set` — Summary

- **Sprint:** sprint-102-desktop-rust-model
- **Completed:** 2026-11-20
- **Status:** all gates pass (see Build & test results).

## What was implemented
- **`Session` storage.** `Session::new()` is unchanged and in-memory. `Session::with_config_dir(dir) -> (Session, Vec<Notice>)` is native-only. It reads `settings.json` and `daemon-state/<id>.json` and creates nothing.
- **Current entry.** `current_entry_id() -> Option<EntryId>` returns `local` for now. `None` would mean entry keys stay in memory.
- **Commands (`settings_cmds.rs`).**
  - `settings.get` returns `{autoStartLocalDaemon, cliPath}`.
  - `settings.set {key, value}` returns the same object after the change. It writes `settings.json` atomically before answering.
  - Unknown key, wrong type, a path over 4,096 characters, or a missing `key`/`value` is `BadParams`, and the file is untouched.
  - If the write fails, the setting is rolled back and the error is returned.
- **Storage API on `Session` (not commands).**
  - `storage_snapshot()` returns the global keys plus the current entry's.
  - `storage_set(key, value)` returns `Result<(), LimitError>`. A key or value over a cap is dropped, the old value stays, and the log line names the key only. An unchanged value is not marked dirty.
  - `storage_unwritten()` and `storage_flush()` complete the API. A failed write is logged and the scope stays unwritten. Flush still tries the other scope and returns the first error.
  - Also added `settings() -> &Settings`.
- **`settings.json` writer.** One private `Storage::write(scope)` writes both files, so a setting change and a global key share one path. A setting write also carries pending global keys.
- **Notices.** `Notice::FileReset { file, kept_as }`, with `to_json()` giving `{kind:"file_reset", file, keptAs}`. `file` is relative to the config directory, e.g. `daemon-state/local.json`. `keptAs` is the store's new file name in the same directory.
- **In-memory sessions** never mark anything unwritten.
- **Browser build.** `write_file` has a wasm stub that returns Unsupported. It is never reached, because a wasm session has no directory.
- The checklist sample is untouched.

## Files created / changed
| File | Change |
|---|---|
| `desktop/crates/engine/src/storage.rs` | New: `Storage`, `Notice`, `current_entry_id`, file layout, the one writer, 14 tests |
| `desktop/crates/engine/src/settings_cmds.rs` | New: `settings.get` / `settings.set`, 3 tests |
| `desktop/crates/engine/src/session.rs` | `Session` gains a `storage` field, `with_config_dir`, `settings`, `set_setting`, `storage_*` |
| `desktop/crates/engine/src/{lib,commands}.rs` | Module declarations, exports (`Notice`, `current_entry_id`), registry line |
| `desktop/crates/engine/Cargo.toml` | Added `model` and (native-only) `store`; `tempfile` now `{ workspace = true }` |

`desktop/Cargo.toml` already listed the model and store crates, so it needed no change. `Cargo.lock` is modified in the working tree; I did not change it myself.

## Acceptance criteria
- [x] An empty or missing directory gives defaults and creates no file (`an_empty_directory_…`).
- [x] `autoStartLocalDaemon:false` is written and read back by a second session (`a_setting_is_written_before_the_answer_and_read_back`).
- [x] Unknown key, non-boolean, 4,097-character path, and missing params are `BadParams`; the file bytes are unchanged. A 4,096-character path is accepted (`a_rejected_setting_…`).
- [x] The global key lands under `workbench` in `settings.json`, another key in `daemon-state/local.json`, and both survive a reopen (`keys_land_in_their_scope_…`).
- [x] A value over 4 MiB is dropped and the old value stays; exactly 4 MiB is accepted (`a_value_over_the_cap_…`).
- [x] A corrupt or unknown-version `settings.json` gives defaults, a `*.corrupt-*` file and one notice. A corrupt state file costs only that entry's keys (three tests).
- [x] A flush that cannot write leaves the scope unwritten and returns the error. The other scope is still written, and a later flush succeeds (`a_flush_that_cannot_write_…`).
- [x] The adversarial command test passes with both commands registered. I also added odd key/value combinations in `odd_params_are_errors_never_panics`, because the testkit params carry no `key` or `value` fields.

## Build & test results
- `cargo test -p pistudiodesktop-engine`: 27 passed.
- `cargo test -p pistudiodesktop-engine --test panic_hunt -- --ignored`: passed.
- `cargo clippy --workspace --all-targets -- -D warnings`: clean.
- `cargo xtask layers`: ok (11 crates).
- `cargo xtask wasm`: ok.
- `cargo fmt --check`: ok.

## Follow-ups
- sprint-106/task-003 records the spec deviation: the engine calls the native-only store crate directly instead of going through service hooks (already noted in the task).
- Unwritten state is meaningful only for sessions opened with a directory. The app (sprint-103/task-001) decides when to call `storage_flush`.

## Proposed doc edits for the orchestrator
- **`desktop/AGENTS.md`, engine section:**
  - `Session` also holds the settings and the workbench's stored keys, persisted under a config dir via `Session::with_config_dir` (native only).
  - `settings.get` and `settings.set` are the settings commands.
  - Stored keys use `storage_snapshot`, `storage_set`, `storage_unwritten` and `storage_flush`, and are not commands.
  - Files are `settings.json` and `daemon-state/<entry id>.json`. Corrupt files are set aside and reported as `Notice::FileReset`.
- **Engine source layout tree:** add `storage.rs` (settings and keys storage, notices, the one file writer) and `settings_cmds.rs` (the two settings commands).

## Wave gate (orchestrator)
```
cargo fmt --check OK; clippy --workspace -D warnings clean; cargo test --workspace no failures; panic_hunt --ignored 1 passed; xtask layers ok (11 crates); xtask wasm ok. Doc edits deferred to sprint-102/task-005.
```
