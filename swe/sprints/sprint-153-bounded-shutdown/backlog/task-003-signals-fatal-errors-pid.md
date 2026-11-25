# Task 003 — Signals, fatal errors, and a second daemon that loses the port

- **Sprint:** sprints/sprint-153-bounded-shutdown
- **Status:** backlog
- **Type:** bugfix
- **Area:** packages/server (daemon run and bootstrap)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002

## Goal
The daemon always exits when told to, logs what killed it, and a daemon that fails to start cleans up
after itself without touching another daemon's PID file.

## Context / why
`run.ts`: if `close()` rejects, `exit` is never called; a second SIGINT does nothing; there is no
hard-kill timer. No `unhandledRejection` or `uncaughtException` handler exists, so a stray rejection
kills the daemon with Node's default, and under the CLI's detached start (stdio ignored) nothing is
recorded. New while planning: the PID file is written before `listen`, so a second daemon that loses
the port overwrites the first daemon's PID file with its own dying PID, and that path closes only the
socket server although the relay, the update service and agent recovery have already started.

## Scope references
- `docs/daemon-audit-handoff.md` § "M5 choices" (the **Choice** on signals and errors), § T1, § T5
- `packages/server/src/daemon/run.ts` (:18, :34-54), `bootstrap.ts` (`writePidLock` :238-246 called
  at :311, the `EADDRINUSE` path :919-931), `packages/cli/src/binary-main.ts` (the `daemon` case)
- `packages/server/src/daemon/run.test.ts`, `listen.test.ts`

## What to build
- **Signals.** The first SIGINT or SIGTERM runs the shutdown and exits 0. If the shutdown rejects the
  daemon still exits (code 1). A second signal exits 1 at once. A timer of the deadline plus 2 s exits
  1 if the shutdown has not finished.
- **Errors.** `uncaughtException`: log at fatal, run the bounded shutdown, exit 1.
  `unhandledRejection`: log at error with the reason, keep running. Installed in `runDaemon`, so the
  npm daemon and the compiled binary both get them. The fatal line reaches the log file before exit.
- **PID file.** Written only after a successful `listen`. Any listen failure runs the same shutdown
  runner and never writes or removes a PID file that names another live process.

## Out of scope
Making the PID file a real lock (T5, not approved).

## Acceptance criteria
- [ ] A second signal during a hanging shutdown exits 1 at once (fake host).
- [ ] A shutdown that rejects still exits; a shutdown that hangs is ended by the timer.
- [ ] An uncaught exception logs, shuts down and exits 1; an unhandled rejection is logged and the
      daemon keeps answering `/api/health`.
- [ ] A second daemon on a taken port exits 1, the first daemon's PID file is byte-identical, and
      nothing the second one started is left running (no open handles keep the test alive).

## Test / verification plan
- `npx vitest run packages/server/src/daemon`
- `npm run build:server`
