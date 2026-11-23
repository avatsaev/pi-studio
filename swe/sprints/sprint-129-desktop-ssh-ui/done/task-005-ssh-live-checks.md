# Task 005 — Linux live checks of SSH entries in the real webview

- **Sprint:** sprint-129-desktop-ssh-ui
- **Status:** done
- **Type:** test
- **Area:** desktop/docs/platform-checks.md, desktop/docs/development.md
- **Priority:** P1
- **Estimated size:** L
- **Depends on:** task-002, task-003, task-004

## Goal
Every SSH criterion of the spec is seen in the real webview on Linux against an OpenSSH server in front of a loopback daemon.

## Context / why
D20. The image gets `openssh-server` the way the keyring layer is added in `development.md`; a jump host is a second sshd.

## Scope references
- `swe/features/desktop-relay-ssh.md` § Acceptance criteria (SSH, in the real webview; Transfers and recovery for SSH)
- `desktop/docs/development.md`

## What to build
- Image layer with sshd (two instances for the jump host), a user with a key, an encrypted key, a password, an agent; a daemon on 127.0.0.1 only; `pi-studio` installed for one run through nvm and absent for another.
- Run: the four logins and the jump host; chat, terminal, `via: "ssh"`; the host-key dialog (answered with `xdotool`) and a changed key; Start from stopped; not installed with Copy; the config host list; a 1 GiB upload and save with hashes; `kill -STOP`/`-CONT` and a network cut during a transfer.
- Record in `platform-checks.md` § Milestone 4 and the recipe in `development.md`.

## Out of scope
- The 4 GiB comparison (sprint 130).

## Acceptance criteria
- [ ] Each SSH criterion ticked with evidence in the summary, or fixed, or recorded as a blocker.

## Test / verification plan
- The live run; `cargo xtask ci`

## Notes

