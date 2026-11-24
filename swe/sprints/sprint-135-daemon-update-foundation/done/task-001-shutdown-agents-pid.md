# Task 001 — Shutdown closes agent sessions and removes the PID file

- **Sprint:** sprints/sprint-135-daemon-update-foundation
- **Status:** done
- **Type:** bugfix
- **Area:** packages/server (daemon/bootstrap)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
`startDaemon().close()` closes every live agent session and removes `pi-studio.pid`, on every shutdown path.

## Context / why
Spec § Shutdown (D5, P9). Today `close()` kills terminals and sockets only: `pi --mode rpc` children can outlive the daemon and the PID file is never removed.

## Scope references
- `swe/features/self-update.md` § Shutdown, § Ground truth
- `packages/server/src/daemon/bootstrap.ts` (`close()`, `writePidLock`), `packages/server/src/daemon/main.ts`, `packages/server/src/agent/` (the manager's list of live sessions; add a `closeAll` there if none), `packages/server/src/daemon/dev-bootstrap.ts` (same close order)
- `swe/architecture/daemon-bootstrap.md` § Shutdown (amendment)

## What to build
- `close()`: all live agent sessions closed at once, each with a 5 s limit, then its process tree killed; a failure of one is logged and does not stop the rest.
- Remove `pi-studio.pid` at the end of `close()` only when its content is this process's PID.
- The order of the existing steps is unchanged; `close()` stays safe to call twice.

## Out of scope
The update timer (sprint-136/task-003). The CLI's wait for exit (task-002).

## Acceptance criteria
- [ ] With one live mock agent and one terminal, `close()` ends with no agent session open and the PID file gone (integration test with the dev or mock bootstrap).
- [ ] A session whose `close()` never resolves does not hold `close()` longer than its limit.
- [ ] A PID file naming another PID is left alone.
- [ ] Answer the spec's TODO: with a real `pi --mode rpc` child (skipped when no Pi credential is needed: `pi --mode rpc` starts without one), kill the daemon with SIGKILL and record whether the child exits; write the finding in the task summary.

## Test / verification plan
- `npx vitest run packages/server/src/daemon`
- `npm run build:server && npm run typecheck && npm run lint`

## Notes
Docs: `packages/server/AGENTS.md` (shutdown), root `AGENTS.md` § Persistence layout line for `pi-studio.pid`.
