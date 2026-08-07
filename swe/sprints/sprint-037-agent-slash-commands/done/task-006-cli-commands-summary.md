# Task 006 — CLI slash-command subcommands — Summary

- **Sprint:** sprint-037-agent-slash-commands
- **Completed:** 2026-07-22
- **Status:** done

## What was implemented
Added 11 new `agent` subcommands to `packages/cli/src/agent-commands.ts` mapping to the task-005
SDK operations: `session`, `compact`, `new-session`, `resume-session`, `fork`, `fork-messages`,
`clone`, `name`, `export`, `model` (set), `cycle-model`, `last-message`. Each is backed by a
dedicated exported async function (`sessionStatsAgent`, `compactAgent`, `newAgentSession`,
`switchAgentSession`, `forkAgent`, `forkMessagesAgent`, `cloneAgentSession`,
`setAgentSessionName`, `exportAgentHtml`, `setAgentModel`, `cycleAgentModel`,
`lastAssistantTextAgent`) following the exact style of the file's existing `inspectAgent`/
`logsAgent` functions — typed via `client.request<T>()` generics at the RPC boundary, never an
inline `as` cast on a property read (per the repo's `ts-no-inline-cast-access` rule; the initial
draft used inline casts and was rewritten to typed generics + a `ForkMessageRow` interface with an
explicit index signature for `renderTable`'s `Record<string, unknown>[]` constraint).

12 new entries added to the `AGENT_RPC` map (matching the task-001 wire names) for consistency with
the file's existing RPC-name-as-constant convention.

## Files created / changed
| File | Change |
|------|--------|
| `packages/cli/src/agent-commands.ts` | modified — 12 new `AGENT_RPC` entries, 11 new exported action functions, 11 new Commander subcommands under `agent` |
| `packages/cli/src/agent-commands.test.ts` | modified — extended `FakeOptions`/`makeFake` with `rpcErrors` support (mirroring `cli-core.test.ts`'s `fakeContext`), added `describe("agent slash-command operations")` with 12 tests |
| `packages/cli/AGENTS.md` | modified — added the 11 commands to the `agent` group table + a context/exclusion note |

## How it satisfies the scope
- Each subcommand exists under `agent`, parses its args (`-i/--instructions`, `-p/--path`,
  `-e/--entry`, `-o/--out`, `--provider`/`--model`), calls the matching SDK-equivalent daemon RPC,
  and prints a human-readable result (table default, `renderJson` under `--json`).
- Errors from the daemon surface via `withDaemon`'s existing `RpcError`/`RpcTimeoutError` handling
  (clean stderr line + nonzero exit) — verified end-to-end with a real `rpc_error` reply through
  the new `rpcErrors` fake-transport option, exercising the exact
  `unsupported()`-error message shape from task-003's daemon handlers.

## Build & test results
```
$ npx tsc -b packages/cli
(no output — success)

$ npx vitest run packages/cli/src/agent-commands.test.ts
 Test Files  1 passed (1)
      Tests  26 passed (26)

$ npx vitest run packages/cli
 Test Files  15 passed (15)
      Tests  161 passed (161)

$ npx tsc -b packages/cli packages/protocol packages/server packages/client
(no output — success, confirms the whole sprint-037 chain builds together)
```

## Acceptance criteria
- [x] Each subcommand exists under `agent`, parses its args, calls the matching SDK method, prints a useful result. (12 tests covering all 11 commands)
- [x] Errors from the daemon (unknown agent, unsupported op) surface as a clear non-zero-exit CLI error, not a stack trace. (verified via the new `rpcErrors` fake-transport path)
- [x] `npm run build:cli` and `npm run typecheck` pass. (`tsc -b` clean across cli + all upstream sprint-037 packages)

## Follow-ups / TODO(verify)
- web-client affordances for these 11 operations, and any UI for the ~10 TUI-only built-ins, remain
  out of scope per the sprint's stated boundary (server + SDK/client + CLI only).
