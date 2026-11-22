# Task 004 — `daemon_resolve_current` no longer returns a password — Summary

- **Sprint:** sprint-116-desktop-bridge-wiring
- **Completed:** 2026-11-22
- **Status:** done

## What was built
- For a local or direct entry `daemon_resolve_current` answers `{ url, connect: true }`; a relay entry's answer is unchanged (`url` is the pairing link).
- The `password` field is gone from `Dial::Connect` itself rather than dropped in `dial_for_page`. New `DialPlan::Open(BridgePlan)` carries a local or direct entry's address and where its password is; `DialPlan::finish` no longer reads the store for those entries (only a relay's pairing link), so a connect asks the keychain once (in `transport_open`) instead of twice; `plan_bridge` unwraps `Open`.
- Behaviour change: a direct entry whose secret is missing or unreadable now shows `secret_missing` / `secret_unavailable` at `transport_open`, not at `daemon_resolve_current`; relay entries still show them at `daemon_resolve_current`.
- The owner-thread plan JSON key for "where the password is" was renamed `source` (was `password`) so the guard test's key check can run on those replies.

## Files changed
Engine `crates/engine/src/local.rs` (+ tests, `secret/tests.rs`); shell `daemons.rs`, `owner_access.rs`, `supervisor.rs`, `supervisor/tests.rs`, `tests/secret_guard.rs`; app `src-tauri/src/commands.rs`, `commands/tests.rs`, `src/host/daemons.ts`, `daemons.test.ts`; docs `desktop/docs/architecture.md` (command table, § Secrets, the secret-store-call decision row) and `desktop/AGENTS.md` rule 10.

## Commands run
- `cargo test --no-fail-fast -p pistudiodesktop-engine -p pistudiodesktop-shell -p pistudiodesktop`: all pass (78, 63, 184, and the guard test). `process::tests::output_is_returned_and_environment_is_not_inherited` failed once in a first parallel run and passed in isolation and in the rerun; the file was not touched and the cause was not investigated.
- Clippy `-D warnings`, `cargo fmt` on the three crates: clean. App: `npm run check`, `lint` clean, `npm test` 129 passed.
- Wave gate (orchestrator): `cargo xtask ci` in `desktop/`: all 8 steps passed. No file under `packages/` changed since the last root run.

## Acceptance criteria
- [x] The dial answer for a direct entry with a password has no `password` field: `commands/tests.rs` asserts exactly `{"url":"10.0.0.2:8080","connect":true}`; the supervisor, owner thread and guard test assert the same.
- [ ] **"The window still connects to a password-protected daemon in the container": run in 116/task-005 run (1)** (a production daemon with a password); see that summary.
- [x] The guard test fails if the field is put back: `page_answers_hold_no_password` in `secret_guard.rs` (local, direct, relay entries; owner-thread plan replies; `boot`; the marker password still reaches Rust's dial through `bridge_password`; the relay link is the one allowed secret). Shown failing once with the field temporarily put back ("the page's answer for the local entry leaked secret …"), then restored.
- [x] `cargo xtask ci` and the app's `npm test` pass.

## Follow-ups / TODO(verify)
- The one-off failure of `output_is_returned_and_environment_is_not_inherited` (shell `process` tests, parallel run): possibly a timing flake; watch for it in later runs.
- Two new tests: a direct entry's page dial makes no store call (engine); it does not wait on a store that blocks for 3 s (shell). The existing 3 s blocking-store test now uses a relay entry.
