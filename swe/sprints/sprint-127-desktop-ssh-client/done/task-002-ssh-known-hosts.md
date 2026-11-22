# Task 002 — SSH crate: known hosts in `~/.ssh/known_hosts` and the app's file

- **Sprint:** sprint-127-desktop-ssh-client
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/ssh
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-124/task-002

## Goal
A host key is classed known, unknown or changed against both files, and a trusted key is appended to the app's file.

## Context / why
D13, S15. The spec's TODO: whether russh's helpers read hashed and `[host]:port` entries; if not, the lookup is written here.

## Scope references
- `swe/features/desktop-relay-ssh.md` § 7 (Host key), § An unknown host key, D13, S15

## What to build
- `check(host, port, key, files) -> Known | Unknown | Changed`, reading hashed entries and `[host]:port`.
- `trust(host, port, key, app file)`: appends one OpenSSH line, mode 0600, creating the file.

## Out of scope
- The dialog (sprint 128).

## Acceptance criteria
- [ ] Tests: plain, hashed and `[host]:port` entries; a changed key; a second key type for the same host; append and re-read; `~/.ssh/known_hosts` never written.

## Test / verification plan
- `cd desktop && cargo xtask ci`

## Notes

