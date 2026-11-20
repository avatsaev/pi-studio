# Task 003 — Engine: the registry in `Session`, `daemon.list`, `daemon.switch` — Summary

- **Sprint:** sprint-107-desktop-registry-model
- **Completed:** 2026-11-20
- **Status:** engine work done and green. `cargo xtask ci` stops at clippy on an error in `apps/pistudiodesktop/src-tauri` that I did not touch (details below).

## What was implemented
- **Open:** `Storage::open` reads `daemons.json` through the store's set-aside rule.
  - A missing file gives the default registry with only `local`.
  - A corrupt file gives the same registry, a `daemons.json.corrupt-*` file and one `file_reset` notice.
  - The file is written back with `write_private` (0600 on Unix) when it was missing or when what was read differs from its normalised encoding, so a hand-edited but valid file is also rewritten.
  - An in-memory session has the default registry and writes nothing.
- **Current entry:** `lastUsedId` when that entry exists, else `local`. `Session::current_entry_id()` returns it. The old free function `current_entry_id()` in `storage.rs` is deleted, along with its re-export in `lib.rs`; nothing else used it.
- **Per-entry keys:** `Storage` now tracks the current entry's id as a plain `EntryId` and holds the registry. `switch` flushes the entry being left, writes the registry with the new `lastUsedId`, then loads the new entry's keys. If either write fails it answers `write_failed` and nothing changes. A session with no directory keeps the keys of entries it has left in memory.
- **`daemon_cmds.rs`:** `daemon.list` returns `{currentId, entries (EntryView[]), local}`. `daemon.switch {id}` returns `{currentId}`. The error text is exactly the code (`EngineError::Other("not_found")`), and a bad parameter shape stays `BadParams`. Switching to the current entry succeeds and changes nothing. The new module is wired into `commands::build`.
- **`Session` additions:** `registry()`, `current_entry_id()`, `local_state()`, `set_local_state()`, `set_local_supported(bool)` and `take_registry_changed()`.
  - The local state starts as `Checking`. `set_local_supported(false)` sets `Unsupported`.
  - `take_registry_changed()` is true after a real switch or a changed local state, then resets.
  - The `local` field is only stored here, as the task says.

## Files
- `desktop/crates/engine/src/storage.rs`: registry load/write, `switch`, `left` stash, rewritten module tests.
- `desktop/crates/engine/src/session.rs`: the new fields and API.
- `desktop/crates/engine/src/daemon_cmds.rs`: new, with its tests.
- `desktop/crates/engine/src/commands.rs` (one line) and `lib.rs`.

I made no model or store changes.

## Acceptance criteria
- [x] An empty directory gets a 0600 `daemons.json` with the local entry (test `an_empty_directory_gets_a_private_registry_with_local`).
- [x] `daemon.list` on it returns one entry and `currentId: "local"`; the test asserts the serialized list contains no `password"` field.
- [x] Switch to a direct entry B sets `lastUsedId` on disk, and a second session opens on B (`switching_is_written_and_the_next_session_starts_there`).
- [x] A key stored on `local` is absent on B, back on `local`, and the global key is present in both (`stored_keys_follow_the_entry`).
- [x] An unknown id answers `not_found` and the file and change flag are untouched (`an_unknown_id_changes_nothing`).
- [x] A `lastUsedId` naming a missing entry opens on `local` (`a_last_used_id_without_an_entry_opens_on_local`).
- [x] A corrupt `daemons.json` gives the local-only registry, a `daemons.json.corrupt-*` file and exactly one notice (`a_corrupt_registry_is_set_aside`).
- [x] The adversarial test passes with the new commands.

## Build & test results
- `cargo test -p pistudiodesktop-engine`: 27 passed.
- `panic_hunt --ignored`: passed.
- `cargo clippy -p pistudiodesktop-engine --all-targets -- -D warnings`: clean.
- `cargo fmt --check` for the engine: clean.
- `cargo xtask wasm`: ok.
- `cargo xtask ci`: fmt and web pass; the workspace clippy step fails. The cause is `missing field pick_save_path in Services` in `apps/pistudiodesktop/src-tauri/src/commands/tests.rs:193`, so `layers`, `test`, `panic_hunt`, `doctest` and `wasm` were skipped. That file belongs to another agent.

## Follow-ups and decisions to review
- **New code `write_failed`:** it covers a failed flush of the entry being left or a failed registry write on switch. It is not in the spec's table.
- **Silent set-aside on switch:** if the new entry's state file is corrupt, it is set aside and only logged, because `daemon.switch` has no notice channel.
- **`local_supported`:** the spec's "opened with no local daemon" is a setter, `set_local_supported`, rather than a new `with_config_dir` argument, so the four existing callers are unaffected. The app should call it after open.
- **Test changes in `storage.rs`:** three existing tests that asserted nothing is written now expect `daemons.json` to be written at open. The "directory that does not exist stays absent" assertion was dropped, because the registry write creates it.

## Proposed doc edits
- **`desktop/crates/engine/AGENTS.md` / `desktop/docs/architecture.md` § Storage:** the session also loads `daemons.json`, written 0600 at open if missing or normalised. The current entry is `lastUsedId` or `local`. `daemon.switch` flushes the old entry's keys, writes the registry, then loads the new keys.
- **Command table:** add `daemon.list` and `daemon.switch`, with the error text equal to the code and the extra code `write_failed`.
- **API list:** `set_local_supported`, `local_state`, `set_local_state`, `take_registry_changed`, `registry`, `current_entry_id`.

## Wave gate (orchestrator)
```
Engine tests/clippy/fmt/wasm green; workspace clippy blocked only by sprint-104/task-005 in flight — full cargo xtask ci re-run at the next wave gate.
```
