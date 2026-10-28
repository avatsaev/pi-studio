# Task 009 — Sprint close: SDK E2E, real-Pi live E2E, docs, full gates — Summary

- **Sprint:** sprints/sprint-079-agent-todos-daemon
- **Completed:** 2026-10-28
- **Status:** done

## What was implemented
- `packages/cli/src/agent-todos-sdk-e2e.test.ts` (3 tests, real dev daemon + real `PiStudioClient`s + the reducer): pushes fold in order and a
  late joiner's `listAgentTodos` equals the live state (and `AgentTodosError{code:"not_found"}`); `#todo clear` and archive reach every client
  as an empty snapshot with a higher seq; a daemon restart on the same port restarts seq at 1, `resetAgentTodosSeq` + the new process's
  snapshot applies, and the old agent answers `not_found` while the last known state is left untouched.
  *Limit:* the dev daemon is in-memory, so agent ids differ across the restart; the same-agent-id case (client at seq 3, daemon answers seq 1)
  is covered by the live run (g) below and the reducer unit test.
- Docs: root `AGENTS.md` (`agent_todos_*` bullet; "Three places" → "Four", adding `providers/pi/todos.ts` re-checked on an **rpiv-todo** bump too),
  `packages/{protocol,server,client}/AGENTS.md`, `swe/features/agent-todos.md` (status shipped; provider-contract `AgentTodoList`; service-owned
  reconcile triggers + fork hook; both live signals; no parent filter; A1–A13 checked; TODO(verify) resolved), `swe/MAIN-SCOPE.md`, `PLAN.md`.

## Real-Pi live E2E (production daemon `packages/server/dist/daemon/main.js`, disposable `PI_STUDIO_HOME`/`PI_STUDIO_PI_HOME`, rpiv-todo 2.15.0 only + LiteLLM provider, Pi 1.4.0, real model `global.anthropic.claude-sonnet-5-5`, debug logging)
Driven by a throwaway SDK script (deleted), tasks named `SECRETTASK_ALPHA/BETA`:

| Step | Observed |
|------|----------|
| (a) flag | `hasAgentTodosCapability() = true` |
| (b) model-driven `todo` create | `agent_todos_update` `seq=1 1:pending,2:pending`; after the turn settled still 1 frame (the settle reconcile found no change) |
| (c) second call (update) | `seq=2 1:in_progress,2:pending` |
| (d) turn with no todo call | 0 todo frames |
| (e) `/compact` | needed a >20k-token session (first runs: `Nothing to compact (session too small)`); with 4 large filler turns: compaction completed, **0** todo frames, list afterwards unchanged (`seq=2 1:in_progress,2:pending`) |
| (f) fork to before the todo update | `agent_timeline_reset` then `agent_todos_update` `seq=3 1:pending,2:pending` (the forked branch's list) |
| (g) daemon killed and restarted, same home | `pi` processes of the run: **0** before and after `agent_todos_list_request`; list `seq=1 1:pending,2:pending` (client had seq 3) = the forked branch's list, read from the file; `resetAgentTodosSeq` then applying it left the reducer at the new daemon's seq 1 |
| (h) archive | empty snapshot `seq=2` |
| (i) debug logs | 1 log file scanned, 0 containing task text; no `agent-todos` warn lines |

Real `~/.pi` untouched (mtimes identical); disposable homes and the script deleted.

## Build & test results
```
$ npm run build      → success (all packages incl. web-client)
$ npm run typecheck  → success
$ npm run lint       → 0 errors (pre-existing warnings in unrelated files only; none in changed files)
$ oxfmt --check <changed .ts files> → clean
$ npm test           → 233 files, 3181 tests passed
```

## Acceptance criteria
- [x] SDK E2E passes, incl. the restart/reset case
- [x] Every live step (a)–(i) recorded with its observed result
- [x] Docs updated as listed; no contradicted invariant left (the spec's adapter-side settle hook and parent-filter rule were rewritten)
- [x] build, typecheck, lint, test green

## Follow-ups / TODO(verify)
- Sprint-080 consumes `listAgentTodos`/`onAgentTodosUpdate`/`hasAgentTodosCapability`, `applyAgentTodosSnapshot`/`resetAgentTodosSeq`/`snapshotFor`.
- The `skills`-style dev-daemon caveat does **not** apply: the `agent_todos_*` handler is registered in both bootstraps.
- `AgentTodosService` keeps one tiny entry per agent id after sweep (to keep the seq counter); agent ids are never reused.
