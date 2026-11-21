# Task 004 — Engine: `daemon.add`, `daemon.update`, `daemon.remove` — Summary

Sprint: sprint-107 | Completed: 2026-11-20 | Status: done

## What was implemented
- **Commands:** `daemon.add`, `daemon.update` and `daemon.remove` are in `daemon_cmds.rs`.
  - Error text is the registry code (for example `name_taken`), or `write_failed` when the file cannot be written.
  - Params of the wrong type, or an unknown `kind`, give `BadParams`.
  - `update` treats an absent `password` as unchanged and `password: null` as clear.
- **Writes:** each success writes `daemons.json` through `write_private` before the command answers. A refused command, or a write failure, leaves the in-memory registry untouched and the file's bytes unchanged. The `changed` flag is set only on success.
- **Ids:** a new entry gets a fresh UUID v4 from `getrandom` (added as a native-only dependency of the engine). It is not made current. The browser build has no id source, so `add` there answers `write_failed`.
- **Remove:** it writes the registry first, then deletes `daemon-state/<id>.json` and ignores a missing file. If the removed entry was current, the session has no current entry and its entry keys are emptied.
- **No current entry:**
  - `daemon.list` answers `currentId: null`.
  - A write of an entry-scoped key is dropped, with a log line naming the key only.
  - No entry state file is written.
  - After a restart the session opens on `local`.
- **API change:** `Session::current_entry_id()` now returns `Option<&EntryId>`. The only callers I found were in the engine itself.

## Files
- `desktop/crates/engine/src/daemon_cmds.rs`: the three commands and the new tests.
- `desktop/crates/engine/src/session.rs`: `add_entry`, `update_entry`, `remove_entry`, and the `Option` return from `current_entry_id`.
- `desktop/crates/engine/src/storage.rs`: `current` is now an `Option`; commit-then-swap, `fresh_id`, removal cleanup.
- `desktop/crates/engine/Cargo.toml`: `getrandom`, native only.
- `desktop/Cargo.lock` was also updated by cargo for the new dependency; it sits outside `desktop/crates/engine`.

## Build & test results
- `cargo test -p pistudiodesktop-engine`: 33 passed.
- `cargo test -p pistudiodesktop-engine --test panic_hunt -- --ignored`: passed.
- `cargo clippy -p pistudiodesktop-engine --all-targets -- -D warnings`: clean.
- `cargo fmt -p pistudiodesktop-engine`: applied.
- I did not run `cargo xtask ci`.

## Acceptance criteria
- [x] Direct add with a password returns `hasPassword: true`, and the file holds the password (`add_writes_the_entry_with_its_password_and_does_not_switch`).
- [x] `password: null` clears it, an absent field keeps it, and a relay's new link keeps its name and id (`update_changes_only_what_is_given`).
- [x] Every error in the table is produced by a test with the file's bytes unchanged (`refused_commands_leave_the_file_alone`). That includes `too_many`, reached after filling to 64 entries.
- [x] Remove deletes the entry, `daemon-state/<id>.json` and the secret; a walk of the config directory finds no remaining reference to the id, password or its stored value (`removing_deletes_the_entry_its_state_and_its_secrets`).
- [x] After removing the current entry, `daemon.list` has `currentId: null`; after a restart the session opens on `local`; a switch makes an entry current again (same test).
- [x] Removing `local` answers `local_not_removable`.
- [x] A write failure fails `add`, `update` and `remove` with `write_failed`, and `daemon.list` still shows the old registry (`a_write_failure_fails_the_command_and_keeps_the_old_registry`). I forced the failure by putting a non-empty directory where `daemons.json` goes, not a read-only directory, because a read-only directory would not fail the write as root.
- [x] The adversarial panic_hunt test passes. It uses in-memory sessions.

## Follow-ups / TODO(verify)
- Another subagent owns shell and src-tauri. If anything there reads `current_entry_id()` as a plain `&EntryId`, it needs to handle the `Option`. My grep found no callers there, but I did not build those crates.

## Proposed doc edits
- `desktop/AGENTS.md` / engine docs: add `daemon.add`, `daemon.update`, `daemon.remove` to the command list, with the error codes above.
- Document `currentId: null` after removing the current entry, and that entry-scoped key writes are dropped while there is none.
- Note that `current_entry_id()` returns an `Option`.

## Wave gate (orchestrator)
```
Engine tests/clippy/fmt/panic_hunt green; full cargo xtask ci at the next wave gate.
```
