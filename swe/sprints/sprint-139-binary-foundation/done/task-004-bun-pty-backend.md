# Task 004 — A terminal backend for Bun; `node-pty` loaded lazily

- **Sprint:** sprints/sprint-139-binary-foundation
- **Status:** done
- **Type:** feature
- **Area:** packages/server (terminal)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001 (the gate)

## Goal
Under Bun terminals use `Bun.spawn(…, { terminal })`; under Node `node-pty`, imported only when a
terminal is first created.

## Context / why
A4. `node-pty` does not work under Bun (the shell exits in 2 ms with SIGHUP) and importing it at
module load stops the binary's daemon from starting. `PtyBackend` is already an interface.

## Scope references
- `swe/architecture/single-binary-daemon.md` § Decisions (A4), § Measured in the spike
- `packages/server/src/terminal/pty-backend.ts`, `terminal-manager.ts`
- Create: `packages/server/src/terminal/bun-pty-backend.ts`

## What to build
- `BunPtyBackend` implementing `PtyBackend`: spawn with a real TTY, write, resize, kill, exit code,
  data events.
- Backend choice at runtime (`typeof Bun !== "undefined"`); `node-pty` behind a dynamic `import()`.

## Out of scope
Windows (D3).

## Acceptance criteria
- [ ] On Node the existing terminal tests pass unchanged.
- [ ] A test run under Bun (`npx bun test` of a small backend test, or a script) spawns `/bin/sh`,
      echoes, resizes and exits with the right code.
- [ ] Importing the server module under Bun does not load `node-pty`.

## Test / verification plan
- `npm test` (Node); the Bun check command and its output in the summary.

## Notes
The full terminal check through the daemon is in sprint-140/task-003's smoke test.
