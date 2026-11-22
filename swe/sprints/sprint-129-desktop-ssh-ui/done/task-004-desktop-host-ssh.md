# Task 004 — Desktop host: the SSH members and the engine for SSH

- **Sprint:** sprint-129-desktop-ssh-ui
- **Status:** done
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src/host
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, sprint-128/task-005, sprint-126/task-003

## Goal
The desktop host parses SSH entries and the remote state, implements `remote` and `sshHosts`, and uses the engine for SSH transfers.

## Context / why
§ 9.

## Scope references
- `swe/features/desktop-relay-ssh.md` § 9
- `desktop/apps/pistudiodesktop/src/host/daemons-view.ts`, `desktop-host.ts`, `transfers.ts`, `desktop-host.test.ts`

## What to build
- `ENTRY_KINDS` gains `ssh`; the view parses `ssh` and `remote`; `remote.start/refresh` through `engine_command`; `sshHosts` through `ssh_config_hosts`; the engine for every kind.

## Out of scope


## Acceptance criteria
- [ ] Host tests: the view with an SSH entry and each remote state; the two commands called with the right ids; the kind matrix.

## Test / verification plan
- `cd desktop/apps/pistudiodesktop && npm run check && npm test`

## Notes

