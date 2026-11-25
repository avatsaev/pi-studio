# Task 004 — Nothing the daemon started outlives it

- **Sprint:** sprints/sprint-153-bounded-shutdown
- **Status:** done
- **Type:** bugfix
- **Area:** packages/server (extensions, resources, provider auth, file transfer, terminals)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-003

## Goal
After a stop there is no child process, timer or half-written upload left from the daemon.

## Context / why
Checked on 2026-11-25: no code stops a running `pi install` or `skills` spawn at shutdown (extensions
sync and the resource service share `defaultInstallSpawn`, which keeps no list of live children);
provider login flows keep their timers; uploads in flight are only cleaned up by the socket's close
event, which the shutdown does not wait for; `TerminalManager.killAll` sends SIGTERM and does not wait
or escalate.

## Scope references
- `docs/daemon-audit-handoff.md` § "M5 choices", § T1, § F4 (third bullet), § 7 (installs at shutdown)
- `packages/server/src/extensions/sync-executor.ts` (`defaultInstallSpawn` :72-107),
  `resources/spawn-runner.ts`, `resources/resource-service.ts` (the queue, :213)
- `packages/server/src/auth/provider-auth-service.ts` (`disposeSession` near :205, `abortFlow`)
- `packages/server/src/files/file-transfer.ts` (`disposeSession` :598), `files/upload-journal.ts`
- `packages/server/src/terminal/terminal-manager.ts` (`kill` :328-336, `killAll` :341-345)
- `packages/server/src/update/update-service.ts` (the apply pipeline calls this same shutdown)
- `packages/server/src/daemon/bootstrap.ts` (`closeDaemon` step list), `dev-bootstrap.ts`

## What to build
- **Install children.** The spawn seam keeps a registry of live children; `close()` on the extensions
  and resource services rejects queued work and tree-kills what is running (SIGTERM, then SIGKILL
  after a short grace).
- **Login flows.** `ProviderAuthService.close()` aborts every flow and clears its timers.
- **Transfers.** `FileTransferService.close()` ends uploads in flight (temporary file removed, journal
  updated) and downloads.
- **Terminals.** `killAll()` returns a promise: SIGTERM, wait up to 2 s, then SIGKILL. A single
  `kill()` escalates the same way.
- Each is a named step of the shutdown runner. Remaining daemon timers are unref'd.
- **The update pipeline** ends in this shutdown: the helper it spawned and the version it installed
  must survive it.

## Out of scope
An orphaned tool subprocess of a Pi that was killed with SIGKILL (recorded in M3, not fixed here).

## Acceptance criteria
- [ ] A real child (`sleep 60`) started through the install seam is dead after `close()`; queued
      installs reject.
- [ ] A terminal whose shell ignores SIGTERM is dead after `killAll()` resolves.
- [ ] An upload in flight at shutdown leaves no `.pistudio-upload-*.part` file.
- [ ] A daemon started as a child process, with an install running and a terminal open, exits within
      the deadline on SIGTERM and leaves no process behind.
- [ ] The update pipeline tests still pass (the helper is not killed).

## Test / verification plan
- `npx vitest run packages/server`
- `npm run build:server`
