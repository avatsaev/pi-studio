# Task 002 — `/api/health` carries the version; the CLI's stop and restart wait for the exit

- **Sprint:** sprints/sprint-135-daemon-update-foundation
- **Status:** backlog
- **Type:** bugfix
- **Area:** packages/server (http, update/process-wait), packages/cli (daemon-control, daemon-commands)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
`GET /api/health` answers `{status, version}`; `pi-studio daemon stop` and `daemon restart` wait for the old process to exit.

## Context / why
Spec § Other surfaces, § CLI (D15, P13). `daemon restart` today sends SIGTERM and probes health at once: an old daemon still answering makes it start nothing.

## Scope references
- `swe/features/self-update.md` § Other surfaces, § CLI
- `packages/server/src/http/http-server.ts`
- new `packages/server/src/update/process-wait.ts` (+ test): `waitForProcessExit(pid, {timeoutMs, pollMs, alive?})`
- `packages/cli/src/daemon-control.ts` (`stopDaemon`, `DaemonRuntime`), `packages/cli/src/daemon-commands.ts` (`stop`, `restart`), their tests
- `docker/daemon.Dockerfile` HEALTHCHECK (must still pass: it reads the status only)

## What to build
- Health: `{"status":"ok","version":SERVER_VERSION}`.
- `waitForProcessExit`: polls `process.kill(pid, 0)`; resolves true when gone, false at the limit; pure of the CLI.
- `daemon stop`: SIGTERM, wait up to 10 s; JSON `{stopped}` stays one line, plus `error: "still_running"` when it did not exit (exit code non-zero). A PID file whose process is gone is removed and reported as not running.
- `daemon restart`: stop as above, then start; never reports the stopped process as already running.

## Out of scope
`pi-studio update` restarting the daemon (task-004). The helper (sprint-136).

## Acceptance criteria
- [ ] Health test asserts the version.
- [ ] `waitForProcessExit` tested with a fake `alive`.
- [ ] `restart` test: the old process still answers health for the first polls; the command waits and starts a new one.
- [ ] Live: `for i in $(seq 20); do pi-studio --json daemon restart; done` against a scratch home ends each time with a new PID (record the PIDs).

## Test / verification plan
- `npx vitest run packages/server/src/http packages/server/src/update packages/cli/src`
- `npm run build && npm run typecheck && npm run lint`

## Notes
Docs: `packages/cli/AGENTS.md` and `packages/cli/README.md` (stop/restart), `packages/server/AGENTS.md`, the desktop reads `daemon stop`'s JSON (`desktop/crates/shell/src/cli_answers.rs`): the added `error` member must not break its parser (check, and add a parser test there if it would).
