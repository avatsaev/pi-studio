# Task 002 — A daemon open to the network refuses to start without a password

- **Sprint:** sprints/sprint-146-close-the-door
- **Status:** done
- **Type:** feature
- **Area:** packages/server (bootstraps), packages/cli (daemon start)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Binding a non-loopback address with no password is an error that names the fix, in the daemon and in
`pi-studio daemon start`, instead of a warning in the log.

## Context / why
Finding S2. Today a non-loopback bind with no password logs `UNPROTECTED_BIND_WARNING` and starts
(`bootstrap.ts` near the `listen` call, `dev-bootstrap.ts`, `run.ts` prints "WARNING: no password
set"). Depends on task-001 only because both edit `bootstrap.ts`.

## Scope references
- `docs/daemon-audit-handoff.md` § S2, § Approved improvements (row 1), § Milestones (M1)
- `packages/server/src/daemon/bootstrap.ts`, `dev-bootstrap.ts`, `loopback.ts`, `run.ts`
- `packages/cli/src/daemon-control.ts`, `packages/cli/src/daemon-commands.ts`

## What to build
- `startDaemon`: when `!isLoopbackHost(listen.host)` and no password hash, do not listen; log `error`
  naming `PI_STUDIO_PASSWORD` and `daemon.auth.password`; set `process.exitCode = 1` and call
  `opts.onFatalError` with an error whose code is `unprotected_bind`. Same in the dev daemon (it has no
  password, so a non-loopback bind is always refused there).
- Remove `DaemonHandle.exposedWithoutPassword`, `UNPROTECTED_BIND_WARNING` and the `run.ts` warning
  suffix; no caller remains.
- CLI `daemon start` / `restart`: check the same rule before spawning and print the reason; with
  `--json`, `{ up: false, error: "unprotected_bind" }` and a non-zero exit.

## Out of scope
Docker compose and docs for Docker (task-005).

## Acceptance criteria
- [ ] `PI_STUDIO_LISTEN=0.0.0.0:<port>` with no password: the daemon exits non-zero, the log says why,
      nothing listens.
- [ ] Same with `PI_STUDIO_PASSWORD` set: starts.
- [ ] Loopback with no password: starts, as today.
- [ ] `pi-studio --json daemon start` reports `unprotected_bind`.
- [ ] The desktop app's local entry and SSH entries bind loopback (check `desktop/crates` supervisor
      arguments) and are unaffected.

## Test / verification plan
- `npx vitest run packages/server/src/daemon packages/cli/src`
- `npm run build:server && npm run build:cli`

## Notes
The owner starts the daemon on `0.0.0.0` without a password; after this task that needs a password
(recorded in the handoff). `packages/cli/AGENTS.md` and `fern` daemon pages document the rule.
