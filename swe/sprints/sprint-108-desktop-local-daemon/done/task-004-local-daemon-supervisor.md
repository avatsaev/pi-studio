# Task 004 — Supervisor: run local daemon requests through the CLI, and resolve what to dial

- **Sprint:** sprint-108-desktop-local-daemon
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/shell, desktop/apps/pistudiodesktop-cli
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002, task-003

## Goal
A request queued by the engine is carried out with the real CLI and its outcome applied, one at a time; and one function answers "what do I dial for the current entry", starting the local daemon when the rules say so.

## Context / why
Tasks 001–003 are the three parts: reading answers, finding and running the CLI, and the engine's state. This task joins them in the shell crate, still without Tauri, so the whole local-daemon behaviour is tested with fake hooks and one fake CLI script.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Local daemon state (`probe`, `start`, `restart`, `stop`), § Finding and running the CLI (`runCli`), § Launch (`resolveCurrent`), § Error handling (adopted daemon, `not_healthy`, timeout, CLI older than 0.0.119)
- `desktop/crates/shell/src/` (`lib.rs`: `AppShell`; the modules of task-001 and task-002)
- `desktop/crates/engine` (the request queue and outcome application: task-003)
- `desktop/apps/pistudiodesktop-cli/src/main.rs` (`run`; it uses the engine's `Session` directly today)

## What to build
- **Carrying out one request** (no session access while the CLI runs):
  - `probe`: find the CLI (missing or outdated ends here), then `daemon status` → running or stopped;
  - `start` / `restart`: find the CLI, run the command with its 90 s limit → running, or failed with `not_healthy`, `timeout`, `bad_output`, `spawn_failed`;
  - `stop`: run it with its 15 s limit → stopped (a time-out is failed).
  The CLI is always run with the shell environment, so `node` is found and `PI_STUDIO_*` apply as in a terminal. Calls never overlap: one at a time, in the order asked.
- **The pump:** take the session's queued requests, carry each out off the session's thread, apply the outcome. Offered to both binaries: the app calls it from its background runner (sprint-109/task-002); the CLI's `run` drains it to completion before printing the last answer and exiting.
- **Resolve current**, built on the engine's dial answer:
  - "wait": wait for the pending outcome (bounded by the action's own limit), then ask again;
  - "start needed": queue a start as `daemon.local.start` would, wait for its outcome, then answer the intent or the failure;
  - anything else: pass it on.
- **Probe on demand:** a function "probe now" for the cases the spec lists (launch, the Daemons screen opening, a dropped connection to the local entry), which is `daemon.local.refresh`.
- A fake CLI for tests: a shell script that answers `--version` and `--json daemon status|start|stop|restart` from a small state file, with switches to print garbage, sleep, or report `not_healthy`.

## Out of scope
- Tauri, threads owned by the app, events to the page (sprint-109).
- The real `pi-studio`: the live checks of sprint-109 and sprint-110 use it.

## Acceptance criteria
- [ ] With the fake CLI: `probe` on a stopped daemon gives `stopped`; `start` gives `running` with the script's host and port; a second `start` on a running daemon gives `running` and the script records no second start (adoption).
- [ ] `start` against a CLI that reports `up: false` gives `failed(not_healthy)`; one that prints garbage gives `failed(bad_output)`; one that sleeps past a shortened limit gives `failed(timeout)` and the script's process is gone.
- [ ] With a CLI reporting version 0.0.118 the state is `cli_outdated` carrying `0.0.118`, and no `daemon` command is run.
- [ ] Resolve current on the local entry, stopped, auto-start on: one start runs and the intent is `ws://127.0.0.1:<port>` with the saved password.
- [ ] The same with auto-start off: `local_stopped`, and the script records no start.
- [ ] Resolve current on a direct entry never runs the CLI.
- [ ] Two requests asked at once run one after the other (the script records non-overlapping calls).
- [ ] `pistudiodesktop-cli run --config-dir <tmp> --cmd daemon.local.start --cmd daemon.list`, with `cliPath` set to the fake CLI, prints `running` in the list.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell` (fake hooks; the script tests are Unix-only)
- `cargo test -p pistudiodesktop-cli`
- `cargo xtask ci` in `desktop/`

## Notes
- Limits are parameters so tests can shorten them; the constants of task-001 are the defaults.
- A `pairingUrl` printed by the CLI never leaves task-001's parser. The secret-leak guard runs over this task's log lines too.
- Spec TODO(verify): the 90 s limit against a slow first start is measured with the real CLI in sprint-110/task-007.
