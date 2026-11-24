# Task 005 — Live check: a real global npm install updates itself, and rolls back — Summary

- **Sprint:** sprint-136-daemon-update-service
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- `scripts/daemon-update-check/` (`run.mjs`, `lib.mjs`, `Dockerfile.node`, `verdaccio.yaml`, README): a verdaccio registry (no uplink for `@av-pi-studio/*`), the workspace packed from a clean worktree at versions N, N+1 and a broken N+2, `npm i -g` N as a non-root user with a user-owned prefix, three SDK clients (two direct, one through the repo's relay image). Ten scenarios, 74 expectations, last full run exit 0; results in `packages/server/docs/daemon-update-live-results.md`.
- Seen: offer to all clients without a request; apply N->N+1 with a second apply refused `in_progress`, all three reconnect, same `0.0.0.0:6767`, PID file names the new daemon (308 -> 481), old tree gone; `daemon stop` removes the PID file; broken N+2 -> three failed starts -> N+1 reinstalled, `rolled_back`; read-only folder -> `cannot_update(not_writable)` and a forged apply refused; folder made read-only after the check -> `failed(permission)`, old daemon untouched; autoCheck off; registry stopped during rollback.
- Bugs fixed with tests: (1) `lastResult` never reached the new daemon (the helper writes the file after the daemon read it): the service polls the file every 500 ms for 30 s; (2) rollback with the registry unreachable stalled 120 s: `--prefer-offline` (about 2 s from npm's cache, fails only with a cleaned cache).
- TODO(verify) answered: the server lives at `<root>/@av-pi-studio/cli/node_modules/@av-pi-studio/server/dist/daemon/main.js` (the helper's nested candidate is the one that matters); rollback offline works from the cache only.

## Files changed
`scripts/daemon-update-check/*`, `packages/server/docs/daemon-update-live-results.md`, `packages/server/src/update/{update-service.ts,update-service.test.ts,helper.ts,helper.test.ts}`, `packages/server/{AGENTS,README}.md`, root `AGENTS.md`

## Build & test results
```
Gate: npm run build, typecheck ok; lint 0 errors; npm test -> 318 files / 4536 tests passed; cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed
```

## Acceptance criteria
- [x] each scenario passes with evidence in the results document; two bugs fixed with regression tests.

## Follow-ups
- Not run live: the 6 h timer (fake-timer tests), a hoisted npm layout.
- After a rollback the next check offers the broken version again; remembering it is a design change: open.
- A rollback install killed at its time limit leaves a bare message; npm's generic chown hints end a `failed(permission)` message.
- The live script is not part of CI.
