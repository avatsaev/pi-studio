# Task 005 — Registry over the control socket and the app's CLI, and a guard against leaked secrets

- **Sprint:** sprint-107-desktop-registry-model
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/shell, desktop/apps/pistudiodesktop-cli, desktop/crates/engine (tests)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-004

## Goal
`ui.inspect` includes the registry view, the registry commands work from the control socket and the app's CLI, and a test proves that no answer and no log line contains a secret.

## Context / why
The control socket and the CLI are how an agent or a script drives the app. They see everything a command returns, so "secrets are never returned by a control method" has to be a test, not a habit.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Public contract 1 (last paragraph: secrets), § Error handling ("a control-socket caller lists daemons"), § Acceptance criteria (the last one, and the 0600 / no-secret one)
- `swe/features/desktop-native-host.md` § Public contract 5 (`ui.inspect` returns the settings, the registry view and the menu model)
- `desktop/crates/shell/src/` (`control.rs`: `ui.inspect`, `engine.execute`; `tests.rs`), `desktop/apps/pistudiodesktop-cli/src/main.rs` (`run --config-dir`)
- `desktop/crates/engine/src/daemon_cmds.rs` (task-003, task-004)

## What to build
- `ui.inspect` returns `{ ui, settings, daemons, menus }` where `daemons` is the answer of `daemon.list`.
- A test at the control-protocol level: add a direct entry with a password and a relay entry with a pairing link, run every method and every `daemon.*` and `settings.*` command with valid parameters, capture every answer and every log line produced, and assert that neither secret appears in any of them. The secrets are distinctive strings so a plain search is reliable.
- The same sequence through the app's CLI (`run --config-dir <tmp> --cmd ...`), as a test of the binary.

## Out of scope
- The page's commands and the boot snapshot (sprint-109).
- `daemon.local.*` (sprint-108; its tests extend the guard).

## Acceptance criteria
- [ ] `ui.inspect` returns the registry view with `currentId` and the entries, and no `password` or `pairingLink` key at any depth.
- [ ] The guard test fails when a secret is deliberately added to an answer or a log line (shown once while writing the test, then removed).
- [ ] `pistudiodesktop-cli run --config-dir <tmp> --cmd 'daemon.add {...}' --cmd daemon.list` prints the new entry's view and `<tmp>/daemons.json` holds the entry.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell`
- `cargo test -p pistudiodesktop-cli` (or where the CLI's tests live)
- `cargo xtask ci` in `desktop/`

## Notes
- The CLI's `--cmd` arguments are visible in the process list and the shell history. A password passed that way is the caller's choice; say so in the CLI's help text.
- Documents are updated at the end of the plan (sprint-109/task-006 for the control protocol, sprint-111/task-003 for the rest).
