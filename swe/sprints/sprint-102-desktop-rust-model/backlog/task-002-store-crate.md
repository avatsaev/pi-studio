# Task 002 — `store` crate: the app's files, read safely and written atomically

- **Sprint:** sprint-102-desktop-rust-model
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/store (new)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
One small crate reads and writes the app's JSON files so that a bad file never stops the app and a failed write never damages the file that was there.

## Context / why
Settings, per-entry state and, later, the daemon registry all need the same three things: read with a fallback when the file is corrupt (D20), an atomic write, and removal. The app binary and the app's CLI both need them, so they cannot live in the Tauri crate.

## Scope references
- `swe/features/desktop-native-host.md` § Files that cannot be read (D20), § Settings ("Writes are atomic"), § Data & persistence touchpoints
- `desktop/xtask/src/layers.rs` (`TABLE`; storage is layer 3 in its comment), `desktop/Cargo.toml`
- `desktop/crates/engine/src/file_cmds.rs` (how the sample saves atomically today, for reference)
- `desktop/AGENTS.md` golden rule 7

## What to build
- Create `desktop/crates/store` (`pistudiodesktop-store`), layer 3; table row and workspace dependency line. Everything in it is native-only (`cfg(not(target_arch = "wasm32"))`), so the wasm check still passes.
- **Read with a decoder supplied by the caller** (the crate knows no document type):
  - the file is missing: "missing", nothing else happens;
  - it reads and decodes: the value;
  - it cannot be read, is larger than 32 MiB, or the decoder refuses it: rename it to `<name>.corrupt-<UTC timestamp>` beside itself and answer "reset", with the new name. Two resets in the same second must not collide. If the rename itself fails, still answer "reset" (without a name) and log it.
- **Atomic write:** create missing parent directories, write a temporary file in the same directory, flush it to disk, rename it over the destination. On failure the destination is untouched and no temporary file is left.
- **Remove:** succeeds when the file is already gone.
- The file's name only (never its content) appears in log lines.

## Out of scope
- File modes (the registry's 0600 comes with its own plan).
- Which files exist and what is in them (task-001, task-003).

## Acceptance criteria
- [ ] Reading a missing file answers "missing" and creates nothing.
- [ ] Reading a file of garbage answers "reset": the original bytes are in a `*.corrupt-*` file beside it and the original name is free.
- [ ] Two resets within one second produce two different kept files.
- [ ] An atomic write replaces an existing file, creates missing directories, and leaves no temporary file behind.
- [ ] A write whose destination directory cannot be created returns an error and changes nothing.
- [ ] Removing a missing file is not an error.
- [ ] `cargo xtask layers` lists the crate at L3 and `cargo xtask wasm` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-store` (tests use a temporary directory)
- `cargo clippy -p pistudiodesktop-store --all-targets -- -D warnings`
- `cargo xtask layers && cargo xtask wasm`

## Notes
- Depends on task-001 only because both add a row to `xtask/src/layers.rs` and a line to `Cargo.toml`.
- Spec TODO(verify): whether a file's mode survives the atomic rename matters for the registry, not here. Do not solve it in this task.
