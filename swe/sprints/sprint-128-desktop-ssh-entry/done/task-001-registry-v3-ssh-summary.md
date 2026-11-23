# Task 001 — Model and secrets: kind `ssh`, registry version 3, `RemoteState`, two secret kinds — Summary

- **Sprint:** sprint-128-desktop-ssh-entry
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- `Kind::Ssh`, `NewEntry::Ssh`, `Update` with the SSH fields (`Some(None)` clears), error codes `invalid_host`, `invalid_user`, `invalid_port`, `invalid_path`, `invalid_jump`; each field checked on add, update and decode; `wrong_kind` for SSH fields on other kinds; public checkers `check_host`, `check_user`, `check_port`, `check_identity_file`, `check_jump`.
- Registry version 3: a version 2 file is read and written back as 3; version 4 or above is `UnknownVersion`; a v2 file holding an `ssh` entry is `WrongShape`. The v2 type and function names are renamed to v3 (no old names left).
- `EntryView.ssh: Option<SshView>`; `address` = `[user@]host[:port]`; `RemoteState` and `RemoteFailReason`; `DEFAULT_DAEMON_PORT` 6767.
- `SecretKind::SshPassword`, `SshPassphrase` (1,024 characters each).
- Compile-only engine changes: renames, and `Kind::Ssh => Err("wrong_kind")` in `plan_dial`.

## Files changed
`crates/model/src/{registry.rs,lib.rs}`, `crates/secrets/src/lib.rs`, `crates/engine/src/{local.rs,session.rs,storage.rs,daemon_cmds/tests.rs,secret/tests.rs}`, `crates/shell/tests/secret_guard.rs` (expects version 3)

## Build & test results
```
cargo test -p model -p secrets -> 40 / 34 passed
cargo check --workspace --all-targets -> clean
cd desktop && cargo xtask ci -> all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
```

## Acceptance criteria
- [x] Model tests for every field rule, v2 to v3, the view and `wrong_kind`.
- [x] Secrets tests for the two kinds.

## Follow-ups
- Engine task 128/t002: `daemon.add` still says "kind must be direct or relay"; `Slot::of` maps every non-relay kind to the password slot; removal must delete three secrets.
