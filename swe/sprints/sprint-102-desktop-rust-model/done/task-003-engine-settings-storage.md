# Task 003 — Engine: settings and workbench storage in `Session`, `settings.get` / `settings.set`

- **Sprint:** sprint-102-desktop-rust-model
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/engine
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002

## Goal
The engine's `Session` holds the app's settings and the workbench's stored keys, loads and saves them in a configuration directory, and exposes the settings as two commands.

## Context / why
This is the real model arriving beside the checklist, which is still there after this task (it is deleted in task-004 so the tree builds at every step). Settings are changed only by commands. The workbench's stored keys are opaque strings written many times a second during a drag, so they are a plain `Session` API, not commands.

## Scope references
- `swe/features/desktop-native-host.md` § Storage, § Settings, § Files that cannot be read, § Public contract 5 (rows "Model", "Engine commands")
- `desktop/crates/engine/src/session.rs`, `commands.rs`, `query_cmds.rs` (the shape of a command module), `error.rs`, `lib.rs`
- `desktop/crates/engine/tests/panic_hunt.rs` (runs every registered command)
- `desktop/crates/model`, `desktop/crates/store` (task-001, task-002)

## What to build
- `Session::new()` stays an in-memory session with default settings and no files (tests, wasm). Add a native constructor that opens a configuration directory and returns the session plus the notices of what had to be reset.
- Files, relative to the configuration directory: `settings.json` (settings and the global keys), `daemon-state/<entry id>.json` (the current entry's keys).
- **Current entry id:** one function. It returns `local` for now, the id the registry spec fixes for the entry that always exists; the registry plan replaces its body.
- Commands, in a new `settings_cmds.rs`:
  | Command | Params | Result | Errors |
  |---|---|---|---|
  | `settings.get` | none | `{ autoStartLocalDaemon, cliPath }` | none |
  | `settings.set` | `{ key, value }` | the same object after the change | bad params: unknown key, wrong type, path too long |
  `settings.set` writes `settings.json` atomically before answering (an in-memory session writes nothing).
- Storage API on `Session` (not commands): the snapshot (global keys plus the current entry's), set one key (scope by the model's rule; a value over the cap is dropped with a log line that names the key only), whether anything is unwritten, and flush (write each changed scope's file). A failed write is logged and the scope stays unwritten so a later flush tries again.
- `settings.json` has two writers (a setting, a global key): one function writes it.
- Notices: one per file that was set aside, `{ kind: "file_reset", file, keptAs }`.

## Out of scope
- Deleting the checklist commands and crates (task-004).
- When to flush (the app decides: sprint-103/task-001).
- `daemon.*` commands and `daemons.json` (registry plan).

## Acceptance criteria
- [ ] Opening an empty directory gives defaults and creates no file until something is written.
- [ ] `settings.set` with `autoStartLocalDaemon: false` changes `settings.json`, and a second session opened on the directory reads it back.
- [ ] `settings.set` with an unknown key, a non-boolean, or a 4,097-character path is a bad-params error and the file is unchanged.
- [ ] A global key lands in `settings.json` under `workbench`; another key lands in `daemon-state/local.json`; both survive a reopen.
- [ ] A value over 4 MiB is dropped; the previous value of that key stays.
- [ ] A corrupt `settings.json` gives defaults, a `*.corrupt-*` file and one notice; a corrupt state file costs only that entry's keys.
- [ ] A flush that cannot write leaves the scope unwritten and returns the error.
- [ ] The adversarial command test passes with the two new commands in the registry.

## Test / verification plan
- `cargo test -p pistudiodesktop-engine --lib --tests`
- `cargo test -p pistudiodesktop-engine --test panic_hunt -- --ignored`
- `cargo clippy -p pistudiodesktop-engine --all-targets -- -D warnings`
- `cargo xtask wasm`

## Notes
- **Found at planning time:** the spec's "Services" row puts reading and writing the app's files behind service hooks. This plan has the engine call the native-only `store` crate directly, behind `cfg(not(target_arch = "wasm32"))`, as the sample's file commands do today, so the app and the app's CLI share one code path. sprint-106/task-003 records it in the spec.
- Log lines never contain a stored value.
