# Task 001 — Workbench contract: SSH entries, `RemoteDaemonState`, `remote`, `sshHosts`

- **Sprint:** sprint-129-desktop-ssh-ui
- **Status:** backlog
- **Type:** feature
- **Area:** packages/workbench/src/host/types.ts, test doubles, swe/architecture/workbench-host-adapter.md
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-128/task-002

## Goal
The host contract carries SSH entries, the remote state, its two actions and the host list.

## Context / why
§ 9.

## Scope references
- `swe/features/desktop-relay-ssh.md` § 9
- `packages/workbench/src/host/types.ts`
- `packages/workbench/test/test-daemons.ts`
- `swe/architecture/workbench-host-adapter.md`

## What to build
- Types of § 9; `NewDaemon`/`DaemonPatch` SSH variants; new `DaemonErrorCode`s; the test double updated; the adapter spec amended.

## Out of scope


## Acceptance criteria
- [ ] `npm run typecheck` passes; the test double implements the new members.

## Test / verification plan
- `npm run build:workbench && npx vitest run packages/workbench/src/features/daemons`

## Notes

