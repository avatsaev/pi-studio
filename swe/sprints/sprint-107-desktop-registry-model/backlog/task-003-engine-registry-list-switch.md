# Task 003 — Engine: the registry in `Session`, `daemon.list`, `daemon.switch`

- **Sprint:** sprint-107-desktop-registry-model
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/engine
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002, sprint-103/task-001

## Goal
The engine's `Session` loads and saves `daemons.json`, knows which entry is current, keeps the workbench's stored keys per entry, and answers `daemon.list` and `daemon.switch`.

## Context / why
Until now the current entry was the constant `local`, read through one function (sprint-102/task-003). This task gives that function a real answer and makes a switch move the session's stored keys from one entry's file to another's.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Public contract 1, § Public contract 2 (`daemon.list`, `daemon.switch`), § Launch (the Rust part), § Error handling (`lastUsedId` names a missing entry)
- `swe/features/desktop-native-host.md` § Storage (per-entry scope), § Files that cannot be read
- `desktop/crates/engine/src/` (`session.rs`: the current-entry function, the storage API and flush; `commands.rs`; `settings_cmds.rs` as the shape of a command module; `error.rs`)
- `desktop/crates/engine/tests/panic_hunt.rs`
- `desktop/crates/model` (task-001), `desktop/crates/store` (task-002)

## What to build
- **At open:** read `daemons.json` with the store's set-aside rule (a file that cannot be read gives a fresh registry with only the local entry, and a `file_reset` notice), normalise it (task-001), and write it back as a private file when it was missing or changed by normalising. An in-memory session has a registry with the local entry and writes nothing.
- **Current entry:** `lastUsedId` when that entry exists, else `local`. The function from sprint-102/task-003 returns it.
- **Commands**, in a new `daemon_cmds.rs`:
  | Command | Params | Result | Errors |
  |---|---|---|---|
  | `daemon.list` (query) | none | `{ currentId, entries: EntryView[], local: LocalState }` | none |
  | `daemon.switch` | `{ id }` | `{ currentId }` | `not_found` |
- **`daemon.switch`:** flush the stored keys of the entry being left, set `lastUsedId`, write the registry, then load the new entry's stored keys so the next snapshot is the new entry's. Switching to the current entry changes nothing and succeeds.
- **`local` in the list:** the session holds a `LocalState`. Here it is only stored: `unsupported` when the session was opened with "no local daemon on this platform", else `checking`. Sprint-108 drives it.
- **Error codes:** the error text of a `daemon.*` command is exactly the code of the spec's table (`not_found`, ...), so every caller can match on it. Bad parameter shapes stay bad-params errors.
- **Change counter:** the session exposes whether the registry view or the local state changed since last asked, so the app can rebuild the menu and tell the page.

## Out of scope
- `daemon.add`, `daemon.update`, `daemon.remove` (task-004). `daemon.local.*` (sprint-108).
- Reloading the page, confirms (sprint-109).

## Acceptance criteria
- [ ] Opening an empty directory creates `daemons.json` with the local entry, mode 0600 on Unix.
- [ ] `daemon.list` on it returns one entry, `currentId: "local"`, and no secret field.
- [ ] With a registry holding a direct entry B: `daemon.switch` to B sets `lastUsedId`, the file on disk shows it, and a second session opened on the directory starts on B.
- [ ] A key stored while on `local` is not in the snapshot after switching to B, is back after switching to `local`, and a global key is present in both.
- [ ] `daemon.switch` to an unknown id answers `not_found` and changes nothing.
- [ ] A `lastUsedId` naming a removed entry opens on `local`.
- [ ] A corrupt `daemons.json` gives a registry with only the local entry, a `*.corrupt-*` file and one notice.
- [ ] The adversarial command test passes with the new commands.

## Test / verification plan
- `cargo test -p pistudiodesktop-engine --lib --tests`
- `cargo test -p pistudiodesktop-engine --test panic_hunt -- --ignored`
- `cargo clippy -p pistudiodesktop-engine --all-targets -- -D warnings`
- `cargo xtask wasm`

## Notes
- **Found at planning time:** the engine's errors are plain text and the control answer carries one string. The spec's error column is a list of codes the page must branch on, so the text of a `daemon.*` error is the code itself.
- Depends on sprint-103/task-001 because that task settles how the app drives the session's storage and flush, which a switch reuses.
- No log line may contain a password or a pairing link; task-005 adds the test that scans for them.
