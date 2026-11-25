# Task 005 — The CLI and the desktop app wait as long as a stop can take — Summary

- **Sprint:** sprints/sprint-153-bounded-shutdown
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
The CLI's `STOP_TIMEOUT_MS` is `SHUTDOWN_DEADLINE_MS + 5_000` (15 s), imported through a new narrow `"./shutdown"` export of the server package (the module imports only a logger type); `stop`, `restart` and `rotate-key` use it. The desktop `STOP_TIMEOUT` in `cli_answers.rs` is 20 s, with a comment naming the CLI wait it must exceed. `update/helper.ts` `EXIT_WAIT_MS` (30 s) unchanged.

## Files changed
`packages/server/package.json`, `packages/cli/src/daemon-control.ts`, `daemon-commands.test.ts`, `desktop/crates/shell/src/cli_answers.rs`; docs: `packages/cli/AGENTS.md`, `README.md`, `desktop/docs/architecture.md`, `packages/server/AGENTS.md` (export path bullet).

## Build & test results
```
npx vitest run packages/cli -> 30 files, 561 passed; build:server, build:cli OK; cd desktop && cargo test -p pistudiodesktop-shell -> 352 passed
Interim full-tree gate: npm run build, typecheck 0 errors; lint 0 errors; npm test 338 files, 4847 tests passed
```

## Acceptance criteria
- [x] A daemon that exits after 12 s is reported stopped; one that never exits gives `still_running` after the new wait
- [x] The shell crate's tests pass with the new constant

## Follow-ups / TODO(verify)
- `cargo xtask ci` is run at the end of the sprint (task-006).
