# Task 003 — Signals, fatal errors, and a second daemon that loses the port — Summary

- **Sprint:** sprints/sprint-153-bounded-shutdown
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
`runDaemon` has one stop path (`close()`, then `flushLogger`, then exit). The first SIGINT/SIGTERM exits 0; a rejecting `close()` is logged and exits 1; a second signal exits 1 at once; a timer of `SHUTDOWN_DEADLINE_MS` + 2 s (`HARD_KILL_GRACE_MS`) exits 1. `uncaughtException` logs at fatal, runs the same stop and exits 1; `unhandledRejection` logs at error and the daemon keeps running. `bootstrap.ts` writes the PID file on the HTTP server's `listening` event (not after a shutdown began); any listen error runs the full shutdown steps, then `onFatalError`. New `flushLogger(logger)` waits for the rotating file stream so the fatal line is on disk before exit.

## Files changed
`daemon/run.ts`, `bootstrap.ts`, `logging/logger.ts`, `logging/index.ts`; new `daemon/run-signals.test.ts`, `logging/flush-logger.test.ts`, `test-support/recording-logger.ts`, `test-support/fake-process-host.ts`; edited `run.test.ts`, `listen.test.ts`; docs: `packages/server/AGENTS.md`, root `AGENTS.md` (`pi-studio.pid` line).

## Build & test results
```
npx vitest run run, run-signals, listen, shutdown, bootstrap, logging -> 8 files, 112 passed; oxfmt/oxlint clean
Interim full-tree gate: npm run build, typecheck 0 errors; lint 0 errors; npm test 338 files, 4847 tests passed
```

## Acceptance criteria
- [x] A second signal during a hanging shutdown exits 1 at once
- [x] A rejecting shutdown still exits (1); a hung one is ended by the timer
- [x] An uncaught exception logs, shuts down and exits 1, the fatal line is in the log file; an unhandled rejection is logged and `/api/health` still answers
- [x] A second daemon on a taken port exits 1, the first one's PID file is unchanged, the second runs the full shutdown steps (checked by the step logs, not by an open-handle check)

## Follow-ups / TODO(verify)
- A startup failure thrown synchronously from `startDaemon` (bad listen address, unprotected bind) exits without a log flush; its error line still goes to stdout.
- `manager.recover()` starts before `listen`, and on a lost port it runs concurrently with `closeAll()` (not covered by a test: no agents to recover).
- The daemon logs "listening" a moment before the port is bound (seen by the process test, which retries its connect).
