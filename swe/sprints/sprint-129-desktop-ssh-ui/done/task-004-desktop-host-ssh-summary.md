# Task 004 — Desktop host: the SSH members and the engine for SSH — Summary

- **Sprint:** sprint-129-desktop-ssh-ui
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- Most was already in place from 129/t001: `ENTRY_KINDS` has `ssh`, `daemons-view.ts` parses the `ssh` entry view and `remote`, `daemons.ts` sends `remote.start`/`remote.refresh` through `engine_command` and `sshHosts` through `ssh_config_hosts`.
- The one code gap: `engineServes` in `transfers.ts` served only local, direct and relay; with `--transfers engine` it now serves any current entry, so SSH entries use the engine.
- Tests: `daemons-view.test.ts` (an SSH entry with and without optional fields; the view dropped when an SSH entry has no `ssh` part, another kind has one, or it is malformed; every remote state kept incl. `cli_outdated` and each failure reason; a bad remote value read as `null`), `daemons.test.ts` (the two commands, a refused action rejects with its code, `sshHosts` list and bad shape), `transfers.test.ts` and `desktop-host.test.ts` kind matrix with `ssh`.

## Files changed
`desktop/apps/pistudiodesktop/src/host/{transfers.ts,daemons-view.test.ts,daemons.test.ts,transfers.test.ts,desktop-host.test.ts}`

## Build & test results
```
cd desktop/apps/pistudiodesktop && npm run check -> clean; npx vitest run src -> 148 passed (11 files); oxlint clean (oxfmt has no target files there)
```

## Acceptance criteria
- [x] The view with an SSH entry and each remote state; the two commands called with the right ids; the kind matrix.

## Follow-ups
- A doc line saying the engine serves every kind -> 130/t002.
