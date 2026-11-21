# Task 003 — Engine: local daemon state and the `daemon.local.*` commands — Summary

**Sprint:** sprint-108-desktop-local-daemon. **Completed:** 2026-11-20. **Status:** done.

## What was implemented
- **Commands:** `daemon.local.start`, `.stop`, `.restart` and `.refresh` (new `local.rs`). All answer `{accepted: true}` or a code error.
  - Check order is `unsupported`, then `cli_missing`/`cli_outdated` (not for refresh), then `busy`.
  - Start and restart set `starting`, stop sets `stopping`, refresh leaves the state as it is.
  - Queued requests are `Start`, `Stop`, `Restart` and `Probe`.
- **Busy:** busy lasts from acceptance until `apply_local_outcome`. A refresh while a refresh is pending is accepted without queuing a second probe. Any other action while busy answers `busy` and queues nothing.
- **Host API on `Session`:**
  - `take_local_requests() -> Vec<LocalRequest>` drains the queue.
  - `apply_local_outcome(LocalState)` stores the state, clears busy and marks the registry view as changed. It marks a change even when the state is unchanged.
  - `resolve_current(dial_address: impl Fn(&str, u16) -> String) -> Result<Dial, &'static str>` implements the full dial table.
  - `Dial` is `Connect{url, password: Option<Secret>}`, `StartNeeded` or `Wait`. Its `Debug` redacts the password. Only this function returns a stored password.
- **Model (additive):** `FailReason::code()` returns `not_healthy`, `timeout`, `bad_output` or `spawn_failed`.

## Files
- `desktop/crates/engine/src/local.rs`: new; queue, `Dial`, commands, tests.
- `desktop/crates/engine/src/{lib.rs,session.rs,commands.rs}`: `local_queue` field, `mark_changed`, exports, spec registration.
- `desktop/crates/model/src/registry.rs`: `FailReason::code`.

## Build & test results
- Engine `--lib --tests`: 46 passed. The model crate's tests also pass.
- `panic_hunt -- --ignored`: passed. The four new commands are covered automatically, and nothing in the engine starts a process.
- `cargo xtask wasm` and `cargo check --workspace`: clean.
- `cargo fmt` and `cargo clippy --all-targets` on engine and model: 0 warnings.
- I did not run `cargo xtask ci`.

## Acceptance criteria
- [x] Start from `stopped` answers `accepted`, state `starting`, one `Start` queued (`start_queues_one_request_and_sets_starting`).
- [x] A second action answers `busy` and queues nothing (`a_second_action_is_busy_and_queues_nothing`, `refresh_leaves_the_state_and_merges`).
- [x] Applying `running` clears busy, and `daemon.list` shows it (`an_outcome_clears_busy_and_shows_in_the_list`).
- [x] After `set_local_supported(false)`, all four commands answer `unsupported` and nothing is queued (`without_a_local_daemon_everything_is_unsupported`).
- [x] `cli_missing` refuses start, stop and restart, and a refresh is accepted (`a_missing_or_old_cli_refuses_actions_but_not_a_refresh`, which also covers `cli_outdated`).
- [x] Every row of the dial table has a test (`dial::*`). Direct and local carry the stored password, and `only_resolve_current_returns_a_password` checks that nothing else in the engine returns one.
- [x] The adversarial command test passes.

## Follow-ups / TODO(verify)
- Task-004 must drain `take_local_requests` and call `apply_local_outcome`. `Session::set_local_state` alone does not clear busy.
- If the shell needs to refuse actions after a platform becomes unsupported while busy, the queue is not reset by `set_local_supported`.

## Proposed doc edits
- `desktop/crates/engine/AGENTS.md`: add `local.rs` (local queue, `Dial`, `daemon.local.*`) to the layout. Document `take_local_requests`, `apply_local_outcome` and `resolve_current`, the "commands only record, the host runs" rule, and that `resolve_current` is the only secret-returning path.
- `swe/features/desktop-daemon-registry.md` § Public contract 2: `daemon.local.refresh` answers `{accepted: true}` and the state arrives as a change (sprint-111/task-003 already plans this).

## Wave gate (orchestrator)
```
Wave gate: cargo xtask ci all 8 steps passed (186 tests) after the orchestrator updated the two command-id list assertions (CLI + shell) for daemon.local.*.
```
