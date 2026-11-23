# Task 003 — Shell: the remote daemon's supervisor over a command-runner hook

- **Sprint:** sprint-128-desktop-ssh-entry
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/shell
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002

## Goal
The shell carries out a remote probe or Start through a hook the app fills, reusing `cli_answers`, and applies the resulting `RemoteState`.

## Context / why
D21, S7, § 8. The shell holds no socket (layer rule), as for `Services::transports`.

## Scope references
- `swe/features/desktop-relay-ssh.md` § 8, D14, D21
- `desktop/crates/shell/src/supervisor.rs`, `cli_answers.rs`, `services.rs`

## What to build
- `Services::remote_run`: a hook `(command, limit) -> Result<{status, stdout}, code>`.
- Probe: `pi-studio --version` (15 s) → `not_installed` / `cli_outdated` / then `running` or `stopped` by what the app's last open saw; Start: `pi-studio --json -H 127.0.0.1:<port> daemon start` (90 s) read by `cli_answers`, `pairingUrl` discarded; `no_shell`, `exec_failed`.
- No output is logged.

## Out of scope


## Acceptance criteria
- [ ] Shell tests with a scripted hook: each state, the 90 s limit, an answer with `pairingUrl` not kept, `no_shell`.

## Test / verification plan
- `cd desktop && cargo xtask ci`

## Notes

