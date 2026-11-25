# Task 005 — The CLI and the desktop app wait as long as a stop can take

- **Sprint:** sprints/sprint-153-bounded-shutdown
- **Status:** backlog
- **Type:** bugfix
- **Area:** packages/cli (daemon control), desktop/crates/shell
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-002

## Goal
`daemon stop` and `restart`, and the desktop app's Stop, never give up before the daemon's own limit.

## Context / why
The daemon may now take up to 10 s to stop, plus 2 s before its hard timer. The CLI waits 10 s and then
answers `still_running`; `restart` then does not start a daemon. The desktop app allows the CLI 15 s
and kills it.

## Scope references
- `docs/daemon-audit-handoff.md` § "M5 choices" (15 s and 20 s)
- `packages/cli/src/daemon-control.ts` (`STOP_TIMEOUT_MS` :324, `stopDaemon` :316-346),
  `daemon-commands.ts` (`restart` near :232-246, `rotate-key`)
- `desktop/crates/shell/src/cli_answers.rs` (`STOP_TIMEOUT` :21 and its test :238), `supervisor.rs`
- `packages/server/src/update/helper.ts` (`EXIT_WAIT_MS` 30 s: unchanged, check only)
- `packages/cli/AGENTS.md`, `desktop/docs/architecture.md`

## What to build
- The CLI's stop wait is derived from the daemon's `SHUTDOWN_DEADLINE_MS` (deadline + 5 s) through the
  server package's existing narrow export path, not a second literal.
- The desktop `STOP_TIMEOUT` becomes 20 s, with a comment naming the CLI's wait it must exceed.
- Docs: the two files above.

## Out of scope
Sending SIGKILL from the CLI: the daemon's own timer makes `still_running` a real fault to report.

## Acceptance criteria
- [ ] CLI tests (fake runtime): a daemon that exits after 12 s is reported stopped; one that never
      exits gives `still_running` after the new wait.
- [ ] `cargo test -p shell` passes with the new constant.

## Test / verification plan
- `npx vitest run packages/cli`
- `npm run build:cli`
- `cd desktop && cargo test -p shell`
