# Task 004 — Pi adapter: live todo snapshots + session-file reads — Summary

- **Sprint:** sprints/sprint-079-agent-todos-daemon
- **Completed:** 2026-10-28
- **Status:** done

## What was implemented
- `PiAgentSession`: in the raw `transport.onEvent` intake, `todoDetailsFromFrame(raw)` → `toAgentTodos` fans out to `onTodos`
  subscribers **in addition to** the existing mapping (no parent filter, commented). `onTodos()`, `readTodos()` (re-reads
  `this.sessionFile` on every call, so it follows the fork/new_session rebind; no file → empty list).
- `PiAgentClient.readTodos(handle)`: reads `handle.nativeHandle` without spawning.
- `session-hydration.ts#readTodosFromSessionFile`: `SessionManager.open(file).getBranch()` + `replayTodosFromBranch`, **throws** on an
  unreadable file (unlike the timeline hydration, so the service can log with the agent id). A missing file is an empty branch
  (probed: `SessionManager.open` on a missing path yields an empty branch and creates nothing).
- `PI_CAPABILITIES.supportsTodos = true`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/providers/pi/agent.ts` | live fan-out, `onTodos`/`readTodos`, client `readTodos`, capability |
| `packages/server/src/agent/providers/pi/session-hydration.ts` | `readTodosFromSessionFile` |
| `packages/server/src/agent/providers/pi/todos-wiring.test.ts` | 13 tests |

## Build & test results
```
$ npx vitest run packages/server/src/agent → 42 files (with client) green; pi dir 125 tests passed
$ npm run build:server → success;  npx oxlint (changed files) clean;  npx oxfmt clean
```

## Acceptance criteria
- [x] Fake-transport: `tool_execution_end` and `entry_appended` each reach `onTodos`; a nested frame is delivered; invalid details reach no subscriber; unsubscribe stops delivery
- [x] `readTodos()` against a temp JSONL returns the replayed list; after a rebind it reads the new file
- [x] `client.readTodos(handle)` reads with no process spawned
- [x] Mapped timeline output for the same frames equals `createPiEventMapper().map()`'s own output (regression)

## Follow-ups
- No debug log for validation rejects: the session constructor has no logger (task text allowed skipping).
