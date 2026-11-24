# Task 004 — Bun PTY backend — Summary

- **Sprint:** sprint-139-binary-foundation
- **Completed:** 2026-11-24
- **Status:** done

## What was built
`terminal/bun-pty-backend.ts`: `BunPtyBackend` over `Bun.spawn(cmd, {terminal})` (same env as the node-pty backend, `TERM` set explicitly; exit code from `proc.exited`; `kill()` = `killTree` + `proc.kill()`; write/resize after exit ignored; bad shell path throws synchronously). `pty-backend.ts` loads `node-pty` with a conditional top-level `await import` that is skipped under Bun (comment says why); `createDefaultPtyBackend()` returns `BunPtyBackend` under Bun. `packages/server/bun-tests/bun-pty-backend.bun_test.ts` (6 Bun tests, outside `src/` so tsc and Vitest skip it).
**Deviation:** node-pty loads when `pty-backend.ts` loads on Node, not at the first terminal: `PtyBackend.spawn` is synchronous and the manager relies on a bad shell path throwing from it; async spawn would change that.

## Results
`vitest run packages/server/src/terminal`: 69 passed. `npx bun test packages/server/bun-tests/...`: 6 pass (echo, `stty size` after resize, exit code, 200 KB output before exit, kill = 143, missing shell). A `Bun.plugin` hook that throws on any `node-pty` load stayed silent after importing the terminal module under Bun (a deliberate import trips it).

## Acceptance
- [x] Node terminal tests unchanged. [x] Bun spawn/echo/resize/exit. [x] node-pty never loads under Bun.

## Follow-ups
Sprint 140's `bun build` must mark `node-pty` external. The Bun test is not in an npm script yet (sprint 140's `test:binary`).
