# Task 008 — SDK: agent todos facade + reducer — Summary

- **Sprint:** sprints/sprint-079-agent-todos-daemon
- **Completed:** 2026-10-28
- **Status:** done

## What was implemented
- `PiStudioClient`: `hasAgentTodosCapability()`, `listAgentTodos(agentId)` (throws `AgentTodosError` with the daemon's open-string
  `code` on `{ok:false}` **and** on a malformed success carrying neither `snapshot` nor `ok:false`), `onAgentTodosUpdate(cb)`.
- `agent-todos-state.ts`: pure `applyAgentTodosSnapshot` (per-agent last-value-wins, drops `seq <= lastSeq` returning the same state
  object), `resetAgentTodosSeq` (keeps stored snapshots, lowers each tracked seq so the next snapshot of any seq wins — the
  reconnect rule), `snapshotFor`. Exported from the barrel.
- `test-support/scripted-daemon.ts`: `agent_todos_list_request` added to the manually-driven RPC list (same as `agent_ui_list_request`).

## Files created / changed
| File | Change |
|------|--------|
| `packages/client/src/pistudio-client.ts` (+ `.test.ts`, 7 tests) | facade members, `AgentTodosError` |
| `packages/client/src/agent-todos-state.ts` (+ `.test.ts`, 8 tests) | pure reducer |
| `packages/client/src/index.ts`, `test-support/scripted-daemon.ts` | export, harness |
| `packages/client/AGENTS.md` | layout tree, method table, purpose bullet |

## Build & test results
```
$ npx vitest run packages/client → 191 passed;  npm run build:client → success;  oxlint/oxfmt clean on changed files
```

## Acceptance criteria
- [x] Reducer: stale/equal seq dropped, higher applied, reset-then-seq-1 replaces seq-7, agents independent
- [x] Facade: capability flag, list success / refusal / malformed, subscribe/unsubscribe

## Follow-ups
- `packages/client/README.md`'s method table is a deliberately abbreviated subset (omits skills/viewer-settings/agent-ui), so unchanged.
