# Task 002 — Engine: SSH add/update/remove, the SSH plan, and `daemon.remote.*` — Summary

- **Sprint:** sprint-128-desktop-ssh-entry
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- `daemon.add`/`daemon.update`/`daemon.remove` for SSH: three secrets through the secret job in their own slots; `null` clears a secret or an optional field; removal deletes only the slots the kind can have.
- `plan_dial`/`plan_bridge` give `ws://127.0.0.1:<daemonPort>` for SSH; `Session::plan_ssh()` returns `SshPlan` (entry, fields, url, which secrets exist) with `read_secrets(store)`.
- `daemon.remote.start` and `.refresh` on the current entry: `wrong_kind`/`no_current`, `busy`, `not_installed`, `cli_outdated` (refresh still allowed in the last two); a refresh pending merges. The host drains `take_remote_requests()` (`RemoteRequest { entry, action: Start | Probe }`) and reports with `apply_remote_outcome(&entry, state)`, which drops an outcome for an entry that is no longer current. `daemon.list` carries `remote`.
- Switching entries resets the remote state and queue; updating or removing the current SSH entry sets a flag the host reads with `take_ssh_closed()`.
- `PAGE_COMMANDS` gained the two ids.

## Files changed
`crates/engine/src/{remote.rs,remote/tests.rs,secret.rs,session.rs,daemon_cmds.rs,local.rs,commands.rs,lib.rs}`, `crates/shell/src/{daemons.rs,tests.rs}`

## Build & test results
```
cargo test -p engine -p shell -> 80 / 211 passed; cargo test -p pistudiodesktop -> 113 passed
cargo check --workspace --all-targets -> ok; clippy engine+shell clean
```

## Acceptance criteria
- [x] Engine tests cover each command and refusal, the secrets on add/update/remove, the plan, the queue and the reset (13 new tests in `remote/tests.rs`).

## Follow-ups
- `BridgePlan` left unchanged (shell builds it field by field); SSH uses `SshPlan`.
