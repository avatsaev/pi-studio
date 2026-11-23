# Task 003 — Daemon: the update service (state, check, timer, setting, result file) and its handlers

- **Sprint:** sprints/sprint-136-daemon-update-service
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (update/, daemon/bootstrap, config)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, sprint-135/task-001, sprint-135/task-003

## Goal
A production daemon answers the family, checks npm at start and every 6 h, broadcasts changes, and honours `daemon.update.autoCheck`. Apply is refused as `not_available` until task-004.

## Context / why
Spec § Check, § RPCs, § Other surfaces (D3, D16, P4, P5, P8's read side).

## Scope references
- `swe/features/self-update.md` § Check, § Public contract, § Data & persistence touchpoints
- new `packages/server/src/update/update-service.ts`, `update-rpc.ts` (+ tests)
- `packages/server/src/daemon/bootstrap.ts` (register, advertise the flag, send the status after `server_info`, clear the timer in `close()`)
- `packages/server/src/config/daemon-config.ts` (`daemon.update.autoCheck`, env `PI_STUDIO_UPDATE_AUTOCHECK`, a targeted writer like `persistExtensionPacks`)

## What to build
- `UpdateService` with injected seams (latest version, install kind, blockers, clock, timer, result-file reader, broadcast) so every path is tested without npm.
- States and transitions of § Check; `checkError`; a manual check broadcasts `checking`, an automatic one does not.
- At start: read and remove `update-result.json` → `lastResult`; unreadable → removed and logged.
- `daemon_update_set_auto_check_request` writes the config and starts or stops the timer.
- `apply()` exists with its refusals (`in_progress`, `cannot_update`, `not_available`) and an injected pipeline. This task's production pipeline ends in `failed(install)` with the message "not built"; task-004 replaces it. The `daemonUpdate` flag is NOT advertised by this task (task-004 advertises it), so no client offers the action in between; the status line in this task's goal means the handlers exist and are tested through the registry.

## Out of scope
The install, the helper and the restart (task-004). The dev daemon (task-006).

## Acceptance criteria
- [ ] Every state of § Check reached in tests, including each `cannot_update` reason and both `checkError` values.
- [ ] Timer: started when `autoCheck`, unref'd, cleared in `close()` (a daemon closes promptly with it running).
- [ ] The setting: default true; env wins; the RPC writes `config.json` and keeps unknown keys.
- [ ] A session connecting gets the status after `server_info`.

## Test / verification plan
- `npx vitest run packages/server/src/update packages/server/src/daemon packages/server/src/config`
- `npm run build:server && npm run typecheck && npm run lint`

## Notes
Docs: `packages/server/AGENTS.md` (new subsystem section), root `AGENTS.md` env table and persistence layout.
