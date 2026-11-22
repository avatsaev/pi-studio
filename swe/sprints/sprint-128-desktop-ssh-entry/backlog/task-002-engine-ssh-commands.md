# Task 002 — Engine: SSH add/update/remove, the SSH plan, and `daemon.remote.*`

- **Sprint:** sprint-128-desktop-ssh-entry
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/engine
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
The engine adds, edits and removes SSH entries with their three secrets, plans their dial (S3 address), and queues remote Start and refresh.

## Context / why
§ 2 and § 3. Mirrors the local queue but per current entry; `daemon.list` gains `remote`.

## Scope references
- `swe/features/desktop-relay-ssh.md` § 2, § 3, S3, S8
- `desktop/crates/engine/src/daemon_cmds.rs`, `local.rs`, `secret.rs` (`Slot`), `secret_job.rs`, `session.rs`

## What to build
- `daemon.add`/`daemon.update` for SSH (secrets through the secret job; three slots); `daemon.remove` removes all three.
- `plan_dial`/`plan_bridge` for SSH: `ws://127.0.0.1:<daemonPort>` and what the app needs (entry fields, which secrets exist).
- `daemon.remote.start` and `.refresh`: `wrong_kind`, `busy`, `not_installed`, `cli_outdated`; a remote request queue like the local one; `RemoteState` reset when another entry is opened; editing the current SSH entry marks its session to be closed.
- The page's `engine_command` allow-list gains the two ids.

## Out of scope
- Running anything (t003, t004).

## Acceptance criteria
- [ ] Engine tests for each command and refusal, the secrets of add/update/remove, the plan, the queue and the reset.

## Test / verification plan
- `cd desktop && cargo xtask ci`

## Notes

