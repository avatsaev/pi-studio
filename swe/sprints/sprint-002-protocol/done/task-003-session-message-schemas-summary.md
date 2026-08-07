# Task 003 — Session message family schemas — Summary

- **Sprint:** sprint-002-protocol
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
Extended `packages/protocol/src/messages.ts` with the principal session message families and the
RPC-naming convention, then wired the discriminated `sessionMessageSchema` union into the `session`
envelope.

- **Agent:** `agentSessionConfigSchema` + `create_agent_request`/`create_agent_response`,
  `agent_update`, `agent_status`, `agent_list`, `agent_deleted`, `agent_archived`. `agentStatusEnum`
  = `initializing|idle|running|error|closed`.
- **Stream:** `agentStreamEventSchema` discriminated on `kind` (`user_message`,
  `assistant_message`, `reasoning`, `tool_call`, `turn_started`, `turn_completed`, `turn_failed`,
  `turn_canceled`, `error`); `toolCallDetailSchema` discriminated on `kind` (`shell`, `read`,
  `edit`, `write`, `search`, `fetch`, `task`); `agent_stream` carries one event.
- **Timeline:** `fetch_agent_timeline_request` (cursor, `direction:"before"|"after"`, limit) and
  `fetch_agent_timeline_response` (items, `seqStart`, `seqEnd`, `sourceSeqRanges`, `collapsed`,
  `hasNewer`, `startCursor`/`endCursor`).
- **Permissions:** `agent_permission_request`, `agent_permission_resolved`, dotted
  `agent.permission.respond.request`/`.response`, plus a legacy flat `respond_to_permission`.
- **`rpc_error`** correlated by `requestId`.
- **RPC naming:** `rpcName(domain, providerOrSubsystem, operation, direction)` builds dotted names;
  legacy flat names remain accepted (parsed) but are not generated.
- **Envelope:** `sessionEnvelopeSchema.message` now validates known types strictly via the union and
  falls back to a structural base for unknown/future types (append-only / "ignore unknown per handler").

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/messages.ts` | extended — session families, union, RPC helper, envelope refine |
| `packages/protocol/src/session-messages.test.ts` | added — 13 tests |

## How it satisfies the scope
- **websocket-protocol.md § Session message families / RPC naming:** message names + dotted/flat
  convention reproduced; correlated by `requestId`; responses put result under `payload`.
- **agent-sessions.md § Create / Stream events:** `AgentSessionConfig` fields and `AgentStreamEvent`
  / `ToolCallDetail` kinds reproduced.
- **timeline-streaming.md § Fetch:** all paging field names present.
- **tool-permissions.md § Flow messages:** request/resolved + respond RPC.

## Build & test results
```
$ npm run build:protocol      → exit 0 (no type errors)
$ npx vitest run packages/protocol/src/session-messages.test.ts packages/protocol/src/messages.envelopes.test.ts
 ✓ session-messages.test.ts (13 tests)
 ✓ messages.envelopes.test.ts (10 tests)
 Test Files  2 passed (2)
      Tests  23 passed (23)
```

## Acceptance criteria
- [x] `create_agent_request` validates the full `AgentSessionConfig` and rejects bad input (missing
      provider/cwd) and bad enums (verified via `agent_status` enum, which the provider/mode/model
      strings are *not* — those are dynamic, per agent-providers.md).
- [x] `fetch_agent_timeline_request` response carries all paging fields (and rejects when one is
      missing).
- [x] `AgentStreamEvent` discriminates on event kind; `ToolCallDetail` discriminates on tool kind
      (unknown kinds rejected).
- [x] A dotted RPC type and its `.response` correlate by `requestId`; a legacy flat name still parses.
- [x] `rpc_error` carries `requestId` (rejects when absent).

## Follow-ups / TODO(verify)
- Exact wire payload field names for create response, permission request action, and send/interrupt/
  update RPC type names are TODO(verify) against the live `messages.ts`.
- `git`/`worktree`/`attachments`/`images` create fields modelled permissively (shapes TODO(verify)).
- Workspace/git/terminal/chat/schedule/loop families extend the union in their feature sprints.
