# Task 002 — Protocol: `agent_todos_*` family, `agentTodos` flag, `supportsTodos`

- **Sprint:** sprint-079-agent-todos-daemon
- **Status:** done
- **Type:** feature
- **Area:** packages/protocol
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

The wire contract every later task builds on.

## Context / why

Three real `sessionMessageSchema` members (not passthrough pushes, since the push carries the same
snapshot the list RPC does), one server feature flag, one optional provider capability.

## Scope references

- swe/features/agent-todos.md § Public contract › Wire family, § Limits
- packages/protocol/src/messages.ts:1612-1720 (`agentUi*` schemas, the pattern), :1747 (union),
  :1832-1837 (insert before `rpcErrorSchema`)
- packages/protocol/src/client-capabilities.ts:41 (`SERVER_FEATURES`), :65 (`SERVER_FEATURE_COMPAT`)
- packages/protocol/src/provider-manifest.ts:19-40 (`AgentCapabilityFlags`;
  `supportsExtensionUi` at :38 is the precedent). This is where the flag lives, not
  `provider-contract.ts` as the spec implies.
- packages/protocol/AGENTS.md

## What to build

- Schemas, all `.passthrough()`:
  - `agentTodoStatusSchema`: `pending | in_progress | completed`
  - `agentTodoSchema`: `{id: safe int, subject, status, activeForm?, description?, owner?, blockedBy?: int[]}`
  - `agentTodosSnapshotSchema`: `{agentId, seq, tasks, truncated?}`
  - `agent_todos_list_request` `{requestId, agentId}`
  - `agent_todos_list_response`: `{requestId, snapshot}` | `{requestId, ok:false, error}`. `error`
    is an **open string** (s057/t001's lesson), documented value `not_found`.
  - `agent_todos_update` `{snapshot}`
- Exported limit constants: `AGENT_TODOS_MAX_TASKS = 200`, plus the field caps (subject 500,
  activeForm 500, owner 100, description 4000, blockedBy 50 entries). Server applies them; the UI
  hint reads `AGENT_TODOS_MAX_TASKS`. Schemas do **not** enforce caps: a newer daemon may raise them.
- `SERVER_FEATURES.agentTodos` + its `COMPAT` entry.
- `supportsTodos: z.boolean().optional()` on `AgentCapabilityFlags`, with a doc comment.
- Exported types (`AgentTodo`, `AgentTodosSnapshot`, …) from the barrel.

## Out of scope

- Any server/client code

## Acceptance criteria

- [ ] Round-trip parse of each message via `sessionMessageSchema`, including an unknown extra field
  (passthrough) and a `status: "deleted"` task, which is rejected
- [ ] `client-capabilities.test.ts`'s key enumeration and COMPAT tests include `agentTodos`
- [ ] Old payload compatibility: a response without `truncated` parses

## Test / verification plan

- Extend `packages/protocol/src/session-messages.test.ts` and `client-capabilities.test.ts`
- `npx vitest run packages/protocol` and `npm run build:protocol`
- `packages/protocol/AGENTS.md` lists the new family and flag
