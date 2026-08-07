# Task 002 — Agent commands (+ top-level) — Summary

- **Sprint:** sprint-011-cli
- **Completed:** 2026-06-14
- **Status:** done

## What was implemented
The `agent` command group plus its top-level aliases, each mapping to the same WS RPC as its
app/MCP equivalent, built on the task-001 CLI core.

- **`agent-commands.ts`**:
  - `parseProviderModel("pi/<model>")` → `{ provider, model }`.
  - `formatStreamEvent(AgentStreamEvent)` → one-line renderer for every stream/timeline event kind
    (`user_message`, `assistant_message`, `reasoning`, `tool_call`, turn boundaries, `error`).
  - Pure, unit-testable actions: `runAgent`, `lsAgents`, `sendAgent`, `logsAgent`, `attachAgent`,
    `updateAgent`, `inspectAgent`, plus `simpleAgentRpc` for `stop`/`archive`/`delete`/`reload`/`wait`.
  - `registerAgentCommands(program, ctx, setExit)` wires the `agent` group **and** top-level aliases
    (`ls`, `run`, `attach`, `logs`, `send`) so `pi-studio run …` works like `pi-studio agent run …`.
  - `AGENT_RPC` centralizes the command→RPC mapping.
- **`run`** maps to `create_agent_request` with `config.{provider,model,cwd}`, `initialPrompt`, and
  `worktreeName` for `--worktree`; prints the new `agentId`.
- **`ls`** maps to `list_agents_request` with `all`/`global` flags; renders an `agentId/status/
  provider/title` table.
- **`attach`** subscribes to `agent_stream` for the agent id and streams events; exits on a terminal
  turn event with `--until-idle`, or on SIGINT (`AbortSignal`) in production.
- **`logs`** fetches `fetch_agent_timeline_request` (`direction:"backward"`, `limit`) and renders.
- **`send`/`stop`/`update`/`mode`** map to `send_agent_prompt`/`interrupt_agent`/`update_agent`.
- **program.ts** now registers the agent group and gained a default root action (placeholder for
  task-003's local daemon start + QR) so bare `pi-studio` no longer errors.

## Files created / changed
| File | Change |
|------|--------|
| `packages/cli/src/agent-commands.ts` | created |
| `packages/cli/src/agent-commands.test.ts` | added (13 tests) |
| `packages/cli/src/program.ts` | register agent commands + default root action |
| `packages/cli/src/program.test.ts` | added end-to-end `run` dispatch test (+ ctx helper) |
| `packages/cli/src/index.ts` | re-export agent-commands |

## How it satisfies the scope
Maps to `features/cli.md` § Command tree (agent) + § Example invocations and `agent-sessions.md`
§ Other operations:
- `run --provider pi/<model> [--worktree <name>] "<prompt>"` → create+run, prints id.
- `ls -a -g` → list all/global.
- `attach <id>` → live timeline stream; `logs` → history.
- `send`/`stop`/`update`/`mode` → same RPCs as app/MCP (`send_agent_prompt`, `interrupt_agent`,
  `update_agent`).

## Build & test results
```
$ npx tsc -b packages/cli                                   → exit 0
$ npm run build                                             → exit 0 (all packages)
$ npx vitest run packages/cli/src/agent-commands.test.ts \
                 packages/cli/src/program.test.ts \
                 packages/cli/src/cli-core.test.ts          → 33 passed (3 files)
$ npx vitest run            (full suite)                    → 390 passed (58 files)
$ npx oxlint packages/cli/src                               → clean
$ npx oxfmt --check packages/cli/src                        → clean
```

## Acceptance criteria
- [x] `pi-studio run --provider <p>/<model> "<prompt>"` creates+runs an agent and prints its id
      (verified: `run creates+runs an agent and prints its id`, plus the program end-to-end test).
- [x] `pi-studio ls` lists running agents; `-a -g` lists all/global (verified: `ls lists agents …`
      asserts the table + that `all`/`global` flags are sent).
- [x] `pi-studio attach <id>` streams the live timeline (verified: attach streams events, filters by
      agent id, exits on terminal turn / abort signal).
- [x] `send`/`stop`/`update`/`mode` map to the same RPCs as app/MCP equivalents (verified:
      `send maps to send_agent_prompt`; `AGENT_RPC` mapping; `update`/`mode` → `update_agent`).

## Follow-ups / TODO(verify)
- Daemon handlers for `list_agents_request`, `archive_agent`, `delete_agent`, `inspect_agent_request`,
  `wait_for_agent` land in later/integration sprints; the canonical names are used here and flagged
  in `AGENT_RPC`. Tests exercise them against a scripted fake daemon.
- `reload` is mapped to `resume_agent` (scope groups Reload/Resume); confirm if a distinct
  `reload_agent` RPC exists. TODO(verify).
- Exact table columns per command remain TODO(verify) per cli.md.
