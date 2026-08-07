# Task 003 — Session message family schemas

- **Sprint:** sprint-002-protocol
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Define the Zod schemas for the principal session message families that ride inside the `session`
envelope, with append-only/forward-compatible shapes.

## Scope references
- `clean-room-scope/architecture/websocket-protocol.md` § Session message families, § RPC naming convention
- `clean-room-scope/features/agent-sessions.md` § Create, § Stream events
- `clean-room-scope/features/timeline-streaming.md` § Fetch request/response
- `clean-room-scope/features/tool-permissions.md` § Flow messages

## What to build
- Extend `packages/protocol/src/messages.ts` with schemas (request/response correlated by
  `requestId`) for the principal families:
  - Agent: `create_agent_request`/response, `agent_update`, `agent_stream`, `agent_status`,
    `agent_list`, `agent_deleted`, `agent_archived`.
  - Timeline: `fetch_agent_timeline_request`/response (cursor, `direction:"before"|"after"`, limit;
    response: items, `seqStart`, `seqEnd`, `sourceSeqRanges`, `collapsed`, `hasNewer`,
    `startCursor`/`endCursor`).
  - Permissions: `agent_permission_request`, `agent_permission_resolved`, respond-to-permission RPC.
  - `rpc_error` (correlated by `requestId`).
- Encode the **dotted RPC naming** convention (`domain.provider.operation.request`/`.response`) as a
  helper/type; keep legacy flat names accepted (parsed) but not generated.
- `AgentStreamEvent` kinds (`user_message`, `assistant_message`, `reasoning`, `tool_call`,
  `turn_started`, `turn_completed`, `turn_failed`, `turn_canceled`, `error`) and `ToolCallDetail`
  kinds (`shell`, `read`, `edit`, `write`, `search`, `fetch`, `task`).

## Out of scope
- Workspace/git/terminal/chat/schedule/loop message schemas (added in their feature sprints; this
  task defines the agent/timeline/permission core only).
- Binary frames (task-004/005).

## Acceptance criteria
- [ ] `create_agent_request` validates the full `AgentSessionConfig` shape and rejects bad enums.
- [ ] `fetch_agent_timeline_request` response carries all paging fields named above.
- [ ] `AgentStreamEvent` discriminates on event kind; `ToolCallDetail` discriminates on tool kind.
- [ ] A dotted RPC type and its `.response` correlate by `requestId`; a legacy flat name still parses.
- [ ] `rpc_error` carries `requestId`.

## Test / verification plan
- Tests: `npx vitest run .../session-messages.test.ts` — representative valid/invalid for each family.
- Build: `npm run build:protocol`.

## Notes
- Full union is large; this task covers the agent/timeline/permission core. Other families extend the
  union in later sprints. TODO(verify) full payload field names against the live `messages.ts`.
