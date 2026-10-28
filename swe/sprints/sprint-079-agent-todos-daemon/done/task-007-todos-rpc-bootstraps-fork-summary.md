# Task 007 — List handler, both bootstraps, fork reconcile, dev-daemon E2E — Summary

- **Sprint:** sprints/sprint-079-agent-todos-daemon
- **Completed:** 2026-10-28
- **Status:** done

## What was implemented
- `agent-todos-rpc.ts`: `registerAgentTodosHandlers` answers `agent_todos_list_response` flat — `{snapshot}` on success, `{ok:false, error}` on refusal.
- `bootstrap.ts` and `dev-bootstrap.ts`: construct `AgentTodosService` before `AgentManager` (lazy `getAgent`/`resolveClient`), compose both services in the
  single-slot `onSessionAttached`, sweep in the archive/delete branch, bind `onTimelineReset`, register the handler.
- `SlashCommandOpsDeps.onTimelineReset?` is called in `handleFork`'s reset branch, after the `agent_timeline_reset` broadcast (so the reset reaches clients first, then
  the new list).
- Advertisement needed no code (both WS paths advertise every `SERVER_FEATURES` key); the E2E asserts the flag.
- `packages/server/AGENTS.md`: layout lines + "Agent todos" subsystem section.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/agent-todos/agent-todos-rpc.ts` | created |
| `packages/server/src/daemon/bootstrap.ts`, `dev-bootstrap.ts` | wiring |
| `packages/server/src/agent/slash-command-operations.ts` | `onTimelineReset` dep + call |
| `packages/server/src/daemon/agent-todos-e2e.test.ts` | 2 E2E tests on a real dev daemon |
| `packages/server/src/agent/slash-command-ops.test.ts` | fork reconcile tests (2) |
| `packages/server/AGENTS.md` | docs |

## Build & test results
```
$ npx vitest run packages/server → 82 files, 1085 tests passed (before the final test-lint tidy; re-run on the touched files: green)
$ npm run build:server → success;  oxlint (new/changed files) clean;  oxfmt clean
```

## Acceptance criteria
- [x] E2E on the dev daemon: flag advertised; `#todo plan` → update seq 1 (the settled turn adds none); `#todo advance` → seq 2; a second connection lists the latest snapshot (flat, no `ok`); unknown agent → `not_found`; archive → empty snapshot seq 3 on **both** connections
- [x] Fork: a changed list broadcasts after `agent_timeline_reset` (seq 2, new branch's tasks); unchanged/cancelled fork broadcasts no todos update
- [x] Extension-UI behaviour unchanged: the whole server suite (incl. `agent-ui-*`) passes untouched
- [x] `packages/server/AGENTS.md` subsystem section

## Follow-ups
- Production bootstrap has no dedicated test in this task; the production path is exercised by task-009's real-Pi live run.
