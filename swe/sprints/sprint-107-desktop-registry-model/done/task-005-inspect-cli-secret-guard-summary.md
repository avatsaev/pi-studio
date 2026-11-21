# Task 005 — Inspect, CLI and secret guard — Summary

**Sprint:** sprint-107-desktop-registry-model. **Status:** implemented. `cargo xtask ci` fails at clippy, only in files owned by the save-to-disk agent (`S104T005SaveBackend`).

## What was implemented
- `ui.inspect` (`control::view`) now returns `{ui, settings, daemons, menus}`. `daemons` is the `daemon.list` answer: `currentId`, `entries` (views only) and `local`.
- The CLI `--cmd` help now says that a password or pairing link passed on the command line shows in the process list and shell history, and that this is the caller's choice.
- New `crates/shell/tests/secret_guard.rs`:
  - It adds a direct entry with a password and a relay entry with a pairing link, using distinctive strings.
  - It then runs every control method, every `daemon.*` command (valid and refused, some with secrets in the input) and `settings.*`, plus `Boot` and `Flush`.
  - Every answer is checked for the secret strings and for a `password` or `pairingLink` key at any depth. The status bar, the registry's Debug output and every captured log line are checked too.
  - Canaries inside the test show the checks fail on a leak in a log line and in an answer. I did not do the manual one-off "add a secret, watch it fail, remove it" run.
- New CLI test in `cli.rs`: `run --config-dir <tmp> --cmd daemon.add … --cmd daemon.add … --cmd daemon.list` prints the new entries' views (`hasPassword`) and `<tmp>/daemons.json` holds the entries. Stdout and stderr hold no secret. A refused `daemon.update` exits non-zero with `wrong_kind` and no secret.
- Updated three existing tests that were stale after the `daemon.*` commands were registered:
  - the command-id list in `shell/src/tests.rs`
  - the same list in the CLI's `commands` test
  - the exact-view assertion in `shell/src/tests.rs`, which now also checks `daemons`

## Files
`desktop/crates/shell/src/control.rs`, `crates/shell/src/tests.rs`, `crates/shell/tests/secret_guard.rs` (new), `apps/pistudiodesktop-cli/src/main.rs`, `apps/pistudiodesktop-cli/tests/cli.rs`. `cargo fmt --all` ran; it touched no other agent's files that I know of. I did not touch `lib.rs` or `src-tauri`.

## Build & test results
- `cargo test -p pistudiodesktop-shell`: 62 lib tests and 1 guard test pass.
- `cargo test -p pistudiodesktop-cli`: 5 pass.
- `cargo xtask ci`: fmt and web pass; clippy fails with `type_complexity` at `crates/shell/src/saves/tests.rs:253` and `apps/pistudiodesktop/src-tauri/src/commands/tests.rs:367`. Both belong to `S104T005SaveBackend`. Because clippy fails, the `layers`, `test`, `panic_hunt`, `doctest` and `wasm` steps were skipped, so I haven't seen them run.
- Clippy with `-p pistudiodesktop-shell -p pistudiodesktop-cli --all-targets` stops at the same `saves/tests.rs` error, so it did not check my files.

## Acceptance criteria
- [x] `ui.inspect` returns the registry view with `currentId` and entries, and no `password` or `pairingLink` key.
- [~] The guard test catches a leak: shown with canaries in the test, not with a manual one-off.
- [x] The CLI `daemon.add` plus `daemon.list` prints the entry and `daemons.json` holds it.
- [ ] `cargo xtask ci` passes. Blocked only by the other agent's clippy errors; rerun once they are fixed.

## Follow-ups
- **Engine bug (not mine):** `daemon.update {"id":"local","password":"…"}` succeeds and returns `hasPassword:true` for the local entry. The engine test only asserts `wrong_kind` for `address` on `local`. It probably should be `wrong_kind` for `password` too (task-004's area).
- `engine/tests/**` has no new file; the guard sits at the shell control level as the task describes.

## Proposed doc edits
- Control protocol doc: "`ui.inspect` returns `{ui, settings, daemons, menus}`; `daemons` is the `daemon.list` answer, with no secret."
- CLI doc: "`--cmd` arguments are visible in the process list and shell history; a secret passed that way is the caller's choice."

## Wave gate (orchestrator)
```
Shell + CLI tests green; full cargo xtask ci run at the sprint-107/104 wave gate (clippy was blocked by sprint-104/task-005 in flight). Note: a password on the local entry is allowed by the spec (the edit form offers it), so the reported 'engine bug' is intended.
```
