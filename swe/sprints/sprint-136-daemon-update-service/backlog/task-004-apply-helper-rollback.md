# Task 004 — Daemon: apply, the helper, restart and rollback

- **Sprint:** sprints/sprint-136-daemon-update-service
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (update/)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-003, sprint-135/task-002

## Goal
`daemon_update_apply_request` installs, updates extensions, hands over to the helper and shuts down; the helper starts the new daemon, verifies its version and rolls back when it does not start.

## Context / why
Spec § Apply, § The helper (D8, D11, D12, P7, P8, P14).

## Scope references
- `swe/features/self-update.md` § Apply, § The helper
- new `packages/server/src/update/helper.ts` (+ test), `update-service.ts` (the pipeline), `packages/server/src/extensions/sync-executor.ts` (the spawn seam for `pi update --extensions`), `packages/server/src/daemon/bootstrap.ts` and `main.ts` (shutdown then exit; advertise `daemonUpdate`)

## What to build
- Pipeline per § Apply with injected seams (install, extensions, spawn helper, shutdown, exit).
- Failure codes: `permission` (EACCES/EPERM), `network`, `timeout`, else `install`; message = redacted tail, 2048 chars.
- The helper's script is one self-contained string (only Node built-ins); its logic is also exported as a function with injected seams so the three tries, the rollback and the result file are unit-tested; a test asserts the script text has no `import` of a package path.
- The helper finds the daemon's entry again after the install (both npm layouts), carries the environment and the effective listen address, and logs to `logs/update-restart.log`.

## Out of scope
The live run with a real npm (task-005).

## Acceptance criteria
- [ ] Unit: install failure → `failed`, no helper, no shutdown; extensions failure → goes on; helper: new version answers → `updated`; never answers → previous version installed and started → `rolled_back`; rollback fails → `failed` with the log line.
- [ ] A second apply during the pipeline is refused `in_progress`.
- [ ] The flag is advertised.

## Test / verification plan
- `npx vitest run packages/server/src/update`
- `npm run build:server && npm run typecheck && npm run lint && npm test`

## Notes
Never restart the developer's own daemon on 6767 in a test. The daemon's code must not `import()` anything lazily between the install and the exit.
