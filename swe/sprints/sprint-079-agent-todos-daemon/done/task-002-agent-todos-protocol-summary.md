# Task 002 — Protocol: `agent_todos_*` family, `agentTodos` flag, `supportsTodos` — Summary

- **Sprint:** sprints/sprint-079-agent-todos-daemon
- **Completed:** 2026-10-28
- **Status:** done

## What was implemented
Three real `sessionMessageSchema` union members (`agent_todos_list_request`, `agent_todos_list_response`,
`agent_todos_update`), `agentTodoSchema`/`agentTodosSnapshotSchema`/`agentTodoStatusSchema` (`deleted` is not
representable), exported daemon-side limit constants (not enforced by the schemas), `SERVER_FEATURES.agentTodos` + its
`COMPAT` entry, and `supportsTodos` on `AgentCapabilityFlags`.

The list response is **flat**, as the spec says: success `{requestId, snapshot}` (no `ok`), refusal
`{requestId, ok:false, error}`. It is one object schema with optional `snapshot`/`ok`/`error` because
`sessionMessageSchema` is a discriminated union and cannot hold a nested union member. Consumers (task-008) must treat
`ok === false` as the refusal and otherwise require `snapshot`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/messages.ts` | schemas, types, limit constants, union members |
| `packages/protocol/src/client-capabilities.ts` | `agentTodos` feature + COMPAT |
| `packages/protocol/src/provider-manifest.ts` | `supportsTodos` |
| `packages/protocol/src/session-messages.test.ts` | `agent todos (sprint-079/task-002)` describe (5 tests) |
| `packages/protocol/src/client-capabilities.test.ts` | `agentTodos` in the key enumeration |
| `packages/protocol/AGENTS.md` | family rows, flag list, `supportsTodos` note |

## Build & test results
```
$ npx vitest run packages/protocol     → 11 files, 180 tests passed
$ npm run build:protocol               → success
$ npx oxlint packages/protocol         → 0 warnings/errors
$ npx oxfmt <changed ts files>         → clean (diff limited to additions)
```

## Acceptance criteria
- [x] Round-trip parse via `sessionMessageSchema`, extra fields kept at every level, `status:"deleted"` rejected
- [x] `client-capabilities.test.ts` key enumeration and COMPAT test include `agentTodos`
- [x] A response without `truncated` parses

## Follow-ups / TODO(verify)
- `packages/protocol/README.md` has no per-family list, so no change there.
