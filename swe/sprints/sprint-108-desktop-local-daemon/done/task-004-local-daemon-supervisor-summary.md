# Task 004 — Supervisor: run local daemon requests through the CLI, and resolve what to dial — Summary

**Sprint:** sprint-108-desktop-local-daemon · **Completed:** 2026-11-20 · **Status:** done (code complete, gates green)

## What was implemented
- **`shell::supervisor`** (non-wasm), new:
  - `Supervisor { services, ShellEnv, Limits, gate }`. `Limits` defaults to the task-001 constants, and tests shorten it.
  - `carry_out(request, cli_path, refresh_env) -> LocalState` takes no session. A gate mutex makes CLI calls run one at a time, in the order asked.
  - Each request finds the CLI, runs `--version`, then runs `--json daemon status|start|restart|stop` with its own limit.
    - Not found gives `cli_missing`.
    - Too old gives `cli_outdated{version}` and no daemon command runs.
    - Could not start gives `failed(spawn_failed)` and a time-out gives `failed(timeout)`. The process group is killed.
    - Answers map to `running`, `stopped`, `failed(not_healthy)` or `failed(bad_output)`.
  - `trait LocalAccess { take, apply, resolve, request(id) }`, implemented for `Mutex<Session>`. The session is touched only for the instant of a take or an apply. The app can implement it over its owner thread.
    - `take` returns a `Batch` of the queued requests, `cliPath`, and `refresh_env`.
    - `refresh_env` is true when the state is `cli_missing` or `cli_outdated`, so Retry re-reads the shell environment.
  - `pump(&dyn LocalAccess)` loops over take, carry out, apply until nothing is queued.
  - `probe_now(access)` runs `daemon.local.refresh`.
  - `resolve_current(access)`:
    - `Wait` is waited out, bounded by the longest action limit plus slack.
    - `StartNeeded` queues `daemon.local.start` once. A `busy` refusal is waited out.
    - A second `StartNeeded` gives `Err("local_stopped")`.
    - Anything else is passed on.
    - It pumps itself, so it needs no other runner. A concurrent pump is safe.
  - Logs carry only the request name and the state name. A `pairingUrl` never leaves the parser.
- **`shell::process::native_services()`**: fills the run, is_executable, env, home_dir and list_dir hooks.
- **`ShellEnv::preset(env)`**: a cache that already holds an environment, used by tests and `Supervisor::with_env`.
- **CLI `run`**: sets local supported, probes once before the first `daemon.local.*` step (so a `cliPath` set by an earlier step counts), and pumps after every step. Plain runs never read the user's shell.
- **Fake CLI** `crates/shell/tests/fixtures/fake-pi-studio.sh`. It answers `--version` and `--json daemon status|start|restart|stop` from a state dir. `FAKE_PI_MODE` switches it to `garbage`, `sleep`, `not_healthy` or `slow`. It prints a distinctive `pairingUrl`.

## Files
- **Shell crate, new:** `desktop/crates/shell/src/supervisor.rs`, `src/supervisor/tests.rs` (14 tests), `tests/fixtures/fake-pi-studio.sh`.
- **Shell crate, edited:** `lib.rs` (module and doc), `process.rs`, `shell_env.rs`, `Cargo.toml` (`model` moved from dev to regular dependency), `tests/secret_guard.rs` (supervisor phase; the CLI pairing URL added to `SECRETS`).
- **CLI app:** `apps/pistudiodesktop-cli/src/main.rs`, `Cargo.toml` (shell dependency), `tests/cli.rs` (new test).
- **Engine:** untouched.

## Build & test results
- `cargo xtask ci`: all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm).
- Shell: 118 unit tests plus `secret_guard` pass. The supervisor tests were run three times in a row without flaking.
- CLI: 6 integration tests pass.

## Acceptance criteria
- [x] Probe on stopped gives `stopped`. Start gives `running` with the script's host and port. A second start adopts, and the script's `starts` log has one entry (`probe_start_adopt_and_stop`).
- [x] `not_healthy`, `bad_output` and `timeout` each give `failed(...)`, and the timed-out script's pid is dead (`start_failures_carry_their_reason`). A stop that times out is failed too.
- [x] CLI 0.0.118 gives `cli_outdated{0.0.118}` for all four requests, and the `calls` log is empty (`an_old_cli_is_outdated_and_no_daemon_command_runs`).
- [x] Resolve on the stopped local entry with auto-start on runs one start. The intent is `ws://127.0.0.1:6767` with the saved password (`resolve_starts_a_stopped_daemon_when_auto_start_is_on`).
- [x] Auto-start off gives `local_stopped` and no start is recorded (`resolve_with_auto_start_off_stays_stopped`).
- [x] Resolve on a direct entry never runs the CLI (`resolve_on_a_direct_entry_never_runs_the_cli`).
- [x] Three concurrent requests give non-overlapping `begin`/`end` pairs (`requests_asked_at_once_run_one_after_the_other`).
- [x] `run --config-dir <tmp> --cmd <set cliPath> --cmd daemon.local.start --cmd daemon.list` shows `running` in the list (`local_daemon_commands_run_the_cli_set_in_cli_path`).
- [x] `cargo xtask ci` passes.

## Follow-ups / TODO(verify)
- The 90 s start limit against a real slow first start is still unmeasured (sprint-110/task-007).
- The shell-environment read in the CLI is covered only through a fake `SHELL`. The real login-shell path is covered by task-002's tests.
- Sprint-109 should wrap the app's owner channel in `LocalAccess`, call `Supervisor::pump` from the background runner, and use `resolve_current` at launch.
- The script fixture is written once per test process through a `OnceLock`, to avoid `ETXTBSY` when tests run in parallel. Other tests that write and run scripts could hit the same race.

## Proposed doc edits
- **`desktop/AGENTS.md`, shell crate:** add this line.
  - `supervisor.rs`: runs queued local-daemon requests with the `pi-studio` CLI (`Supervisor::carry_out/pump/resolve_current/probe_now`), reaches the session only through `LocalAccess`, and never logs secrets.
  - Also mention `process::native_services` and `ShellEnv::preset`.
- **Spec § Launch / `probe`:** state that the headless CLI probes once before the first `daemon.local.*` step and pumps after each step.

## Wave gate (orchestrator)
```
Agent-run cargo xtask ci (8 steps) passed; orchestrator re-gates with the next wave.
```
