# Task 001 — CLI answers (pure) — Summary

Sprint 108 / completed / Status: done, all gates green.

## What was implemented
New `desktop/crates/shell/src/cli_answers.rs`, plus `pub mod cli_answers;` in `lib.rs`.
- `parse_answer(Command, stdout) -> Answer` reads the last non-empty stdout line as a JSON object and ignores the exit code. `Answer` is `Running{host,port}`, `Stopped` or `Failed(NotHealthy | BadOutput)`.
- The meaning table is implemented as specified, including `up:true` with `error:"no_keypair"` giving running. A missing or mistyped field, or a port that doesn't fit in a `u16`, gives `bad_output`.
- `pairingUrl` is never read into the parsed value, so the secret can't appear in debug output or errors.
- `parse_version` and `check_version` return `VersionCheck::{Ok, Outdated{version}, BadOutput}` against `MIN_CLI_VERSION` (0.0.119). A leading `v`, surrounding whitespace and a pre-release/build suffix are accepted.
- `dial_address(host, port)` turns `0.0.0.0` into `127.0.0.1` and `::` (or `[::]`) into `[::1]`, and brackets IPv6 hosts.
- Constants: `VERSION_TIMEOUT` 5 s, `STATUS_TIMEOUT` 5 s, `START_TIMEOUT` 90 s, `RESTART_TIMEOUT` 90 s, `STOP_TIMEOUT` 15 s.
- The module has no dependency on the model crate. It uses its own small enums, which task-003 can map to `LocalState`/`FailReason`.

## Files
`desktop/crates/shell/src/cli_answers.rs` (new), `desktop/crates/shell/src/lib.rs` (one line).

## Build & test results
- `cargo test -p pistudiodesktop-shell cli_answers`: 8 passed.
- `cargo clippy -p pistudiodesktop-shell --all-targets -- -D warnings`: clean.
- `cargo fmt -p pistudiodesktop-shell`: applied.
- `cargo xtask wasm`: passes.
- I did not run the full shell test suite or `cargo xtask ci`.

## Acceptance criteria
- [x] Warnings before the JSON line and a trailing blank line are handled; `last_non_empty_line_wins` covers both.
- [x] Every row of the table has a test, including `no_keypair` giving running (`status_rows`, `start_and_restart_rows`, `stop_rows`).
- [x] A `start` answer with `pairingUrl` parses, and `pairing_url_is_dropped` checks the secret is absent from debug output for both the success and the bad-output case.
- [x] `0.0.118` is outdated; `0.0.119`, `0.0.122`, `0.1.0` and `v1.2.3` are not; `banana` is `bad_output` (`versions`).
- [x] `0.0.0.0:6767` dials `ws://127.0.0.1:6767`, `::` dials `ws://[::1]:6767`, `192.168.1.5` is kept (`dialing`).
- [x] `cargo xtask wasm` passes.

## Follow-ups
Task-002 and task-003 can reuse `Command`, `Answer`, `VersionCheck`, `dial_address` and the timeout constants as they are. No doc edits proposed.

## Wave gate (orchestrator)
```
Shell tests/clippy/wasm green; full cargo xtask ci at the wave gate.
```
