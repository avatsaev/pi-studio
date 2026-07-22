# Task 006 — CLI slash-command subcommands

- **Sprint:** sprint-037-agent-slash-commands
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-005

## Goal
Add CLI subcommands (under the existing `agent` group) that invoke the new SDK `AgentHandle`
operations, so a Pi built-in like `/session` has a real `pi-studio` equivalent.

## Scope references
- `packages/cli/src/agent-commands.ts` (existing `agent` group: `ls`, `run`, `send`, `stop`, `update`, `mode`, `attach`, `logs`, … built with commander over the SDK)
- `packages/cli/AGENTS.md` (command conventions, output formatting)
- Task-005 SDK methods

## What to build
Add subcommands mapping to the task-005 methods (names mirror the Pi built-ins where sensible):

- `agent session <id>`  → `sessionStats()` — print stats (tokens, cost, context %).
- `agent compact <id> [--instructions <text>]` → `compact()` — print summary.
- `agent new-session <id>` → `newSession()`.
- `agent resume-session <id> --path <sessionPath>` → `switchSession()`.
- `agent fork <id> --entry <entryId>` → `fork()`; `agent fork-messages <id>` → `forkMessages()` (list entryId+text).
- `agent clone <id>` → `clone()`.
- `agent name <id> <name>` → `setSessionName()`.
- `agent export <id> [--out <path>]` → `exportHtml()` — print resulting path.
- `agent model <id> --provider <p> --model <m>` → `setModel()`; `agent cycle-model <id>` → `cycleModel()`.
- `agent last-message <id>` → `lastAssistantText()`.

Keep output formatting consistent with existing agent commands (human-readable by default; reuse any
existing `--json` flag convention if present). Resolve the agent via the same handle path as `send`/`stop`.

## Out of scope
- Web-client (deferred). New SDK methods (task-005). Any UI-only built-in.

## Acceptance criteria
- [ ] Each subcommand exists under `agent`, parses its args, calls the matching SDK method, prints a useful result.
- [ ] Errors from the daemon (unknown agent, unsupported op) surface as a clear non-zero-exit CLI error, not a stack trace.
- [ ] `npm run build:cli` and `npm run typecheck` pass.

## Test / verification plan
- Tests: extend `packages/cli/src/agent-commands.test.ts` against a test daemon (mock provider from
  task-004) — e.g. `agent session <id>` prints stats; `agent compact <id>` prints a summary;
  `agent new-session <id>` succeeds; an unsupported op on mock surfaces a clean error.
  `npx vitest run packages/cli/src/agent-commands.test.ts`.
- Manual smoke: `npm run dev:daemon`, create a mock agent, run `pi-studio agent session <id>` and
  observe stats output.

## Notes
- This sprint intentionally stops at CLI + SDK; web-client affordances (and the ~10 UI-only
  built-ins) are a later sprint.
