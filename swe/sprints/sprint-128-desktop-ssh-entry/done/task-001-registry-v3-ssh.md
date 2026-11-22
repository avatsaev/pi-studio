# Task 001 — Model and secrets: kind `ssh`, registry version 3, `RemoteState`, two secret kinds

- **Sprint:** sprint-128-desktop-ssh-entry
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/model, desktop/crates/secrets
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-124/task-004

## Goal
The registry holds SSH entries in a version 3 file, reads a version 2 file, and the secret store knows the SSH password and the key passphrase.

## Context / why
D8, D17, S10. An older app sets a version 3 file aside (accepted).

## Scope references
- `swe/features/desktop-relay-ssh.md` § 1, § 2 (`RemoteState`), D8, D17, S10
- `desktop/crates/model/src/registry.rs`, `lib.rs` (`decode_at`)
- `desktop/crates/secrets/src/lib.rs` (`SecretKind`)
- `swe/features/desktop-daemon-registry.md` § 1

## What to build
- `Kind::Ssh`; the entry's fields and their rules (§ 1); `NewEntry::Ssh`; `Update` gains the SSH fields with clearing; new error codes `invalid_host`, `invalid_user`, `invalid_port`, `invalid_path`, `invalid_jump`.
- Version 3; a version 2 file decodes and is written back as 3.
- `EntryView` for SSH: `address` = `[user@]host[:port]`, and `ssh { … }`.
- `RemoteState` and its serialisation (§ 2).
- `SecretKind::SshPassword` (`sshPassword`) and `SshPassphrase` (`sshPassphrase`), 1,024 characters each.

## Out of scope
- Engine commands (t002).

## Acceptance criteria
- [ ] Model tests for every field rule, version 2 to 3, the view, `wrong_kind` for SSH fields on other kinds; secrets tests for the two kinds.

## Test / verification plan
- `cd desktop && cargo xtask ci`

## Notes

