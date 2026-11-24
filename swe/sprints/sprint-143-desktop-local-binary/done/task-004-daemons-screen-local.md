# Task 004 — Daemons screen: the local entry's new states; the CLI views removed

- **Sprint:** sprints/sprint-143-desktop-local-binary
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench (daemons), desktop frontend host
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
The local row shows downloading with a percentage, installing, outdated with Update, and the new
failures with Retry; the "CLI missing" view and the `cliPath` field are gone.

## Scope references
- `swe/features/single-binary-daemon.md` § Public contract 4, S10, S12
- `packages/workbench/src/features/daemons/` (`DaemonsScreen.tsx`, `daemons-screen-actions.ts`, presentation modules), `packages/workbench/src/host/types.ts`
- `desktop/apps/pistudiodesktop/src/host/daemons.ts`, `daemons-view.ts` and tests
- `packages/workbench/src/features/connection/daemon-switcher-presentation.ts` (local state labels)

## What to build
Presentation in the pure modules with tests; the host's parse of the new state JSON; text in plain
words ("Downloading the daemon · 42 %", "The download failed · Retry", "The file did not match its
checksum and was deleted · Retry", "Installing the daemon failed · <output> · Retry").

## Out of scope
The command-line tool section (task-005).

## Acceptance criteria
- [ ] Presentation and host tests for every state; no `cliPath` left in the workbench or the desktop frontend.
- [ ] `npm run typecheck`, `lint`, `test` green; `cargo xtask ci` green (the web checks).

## Test / verification plan
- `npx vitest run packages/workbench desktop/apps/pistudiodesktop/src`; `cargo xtask ci`

## Notes
The look is checked in the live run (sprint-145/task-001).
