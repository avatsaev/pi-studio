# Task 002 — Daemons form: the SSH kind and the hosts of `~/.ssh/config`

- **Sprint:** sprint-129-desktop-ssh-ui
- **Status:** backlog
- **Type:** feature
- **Area:** packages/workbench/src/features/daemons (daemon-form.ts and its view)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
The Add and Edit form offer SSH with its fields and secrets, and a list of the config's hosts that fills the form.

## Context / why
D23, S12, § 10.

## Scope references
- `swe/features/desktop-relay-ssh.md` § 10 (form), S12
- `packages/workbench/src/features/daemons/daemon-form.ts`, `daemon-form.test.ts`, the screen component

## What to build
- Kind SSH: name, host, user, port, key file, jump host, daemon port (6767), SSH password, key passphrase, daemon password; secrets follow the saved/Clear rule.
- Above the host: the `sshHosts()` list; choosing one sets host and, when empty, the name, and shows the config's values as placeholders.
- Validation messages for the new codes.

## Out of scope


## Acceptance criteria
- [ ] Pure tests of `buildNewDaemon`/`buildPatch` for SSH, including clearing; the list choice filling the form.

## Test / verification plan
- `npx vitest run packages/workbench/src/features/daemons`

## Notes

