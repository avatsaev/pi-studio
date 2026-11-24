# Task 003 — Daemons screen: Install on an SSH row

- **Sprint:** sprints/sprint-144-desktop-ssh-install
- **Status:** backlog
- **Type:** feature
- **Area:** packages/workbench (daemons), desktop frontend host
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002, sprint-143/task-004

## Goal
An SSH row shows Install for `not_installed`, the stage and percentage while installing, the reason
and Retry on failure, and "This system is not supported (<system>)" with no button; the npm
instructions are removed.

## Scope references
- `swe/features/desktop-ssh-daemon-install.md` § Daemons screen, R7, R8
- `packages/workbench/src/features/daemons/`, `desktop/apps/pistudiodesktop/src/host/daemons.ts`, `daemons-view.ts`

## Acceptance criteria
- [ ] Presentation and host tests for every remote state; `daemon.remote.install` wired.
- [ ] Workbench tests and `cargo xtask ci` green.

## Test / verification plan
- `npx vitest run packages/workbench desktop/apps/pistudiodesktop/src`; `cargo xtask ci`

## Notes
Live look in sprint-145/task-001.
