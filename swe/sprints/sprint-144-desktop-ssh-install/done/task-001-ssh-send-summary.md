# Task 001 — SSH crate: send a file over the connection — Summary

- **Sprint:** sprint-144-desktop-ssh-install
- **Completed:** 2026-11-24
- **Status:** done

## What was built
`Session::send(path, source, size, stall, progress)` in `desktop/crates/ssh` (`session/send.rs`, tests in `session/send/tests.rs`; `error.rs` `SendError`; `command.rs` `quote`; `testing.rs` `Exec::Receive`/`Stall`/`Disconnect`): `/bin/sh -c 'cat > <path>'` over an exec channel (path quoted twice), 256 KiB chunks, progress per chunk, stall timer per accepted piece (and for the exit-status wait), non-zero status = `Rejected{status}`, lost connection = `Closed`, refused exec = `Open`. Beyond the spec: `SendError::Source` for a reader that fails or ends early. A stalled or failed send can leave a truncated file; the caller writes a temp name and renames (R3). `desktop/AGENTS.md` updated by the orchestrator.

## Results
`cargo test -p pistudiodesktop-ssh` 147 tests (12 new), repeated 3 times, clippy `-D warnings` clean. The desktop `cargo xtask ci` was run by the orchestrator (see sprint report).

## Acceptance
- [x] 10 MiB identical; stalled reader; non-zero status; a path with a quote (also run through a real `/bin/sh`). [x] `cargo xtask ci` (see report).

## Follow-ups
Real OpenSSH and `ForceCommand` check: sprint-145/task-001. `desktop/docs/architecture.md` L8 row should mention `send` (check at sprint 145 close).
