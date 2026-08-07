# Task 001 — Protocol schemas for agent command-discovery RPC — Summary

- **Sprint:** sprint-040-agent-command-discovery
- **Completed:** 2026-07-26
- **Status:** done

## What was implemented
Added the append-only wire contract for the per-session command-discovery RPC that surfaces Pi's
`get_commands` (extension commands, prompt templates, skills):

- `agentCommandDescriptorSchema` / `AgentCommandDescriptor` — `.passthrough()` object with
  `name: string` (required) and optional `id`, `description`, `source`
  (`"extension" | "prompt" | "skill"`), `scope` (`"user" | "project" | "temporary"`), `path`.
- `agentListCommandsRequestSchema` / `AgentListCommandsRequest` — `{ type, requestId, agentId }`,
  mirroring `agentSessionStatsRequestSchema` exactly.
- `agentListCommandsResponseSchema` / `AgentListCommandsResponse` — `{ type, requestId, payload:
  { commands: AgentCommandDescriptor[] } }`, mirroring `agentSessionStatsResponseSchema`'s shape.

Both new request/response schemas were registered in the `sessionMessageSchema` discriminated
union (previously only `rpcErrorSchema` closed the list after the steering pair from sprint-039).
No index-file change was needed — `packages/protocol/src/index.ts` already re-exports everything
via `export * from "./messages.js"`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/messages.ts` | added `agentCommandDescriptorSchema`, `agentListCommandsRequestSchema`, `agentListCommandsResponseSchema` (+ inferred types); registered both request/response schemas in `sessionMessageSchema` |
| `packages/protocol/src/session-messages.test.ts` | added imports; added `agent_list_commands_request`/`_response` to the "registers every new type in the session message union" map; added a new `describe("command discovery (sprint-040)")` block covering `agentId` requirement, a populated multi-field-kind commands array, and passthrough tolerance on both command entries and the payload |

## How it satisfies the scope
- Matches `agent_session_stats_request`/`_response` shape exactly per the task's explicit
  precedent (same field set: `type`/`requestId`/`agentId` on the request, `type`/`requestId`/
  `payload` on the response), including `.passthrough()` at every object level.
- `name` is required on `AgentCommandDescriptor`; every other command field (including `id`) is
  optional, per the task-001 notes ("keep `name` required and `id` optional; the adapter mirrors
  `name` into `id`").
- Flat snake_case names (`agent_list_commands_request`/`_response`), consistent with every other
  RPC in `messages.ts`.
- No existing field narrowed or removed anywhere in the file.

## Build & test results
```
$ npm run build:protocol
> tsc -b packages/protocol
(clean, no output)

$ npx vitest run packages/protocol
 Test Files  9 passed (9)
      Tests  82 passed (82)

$ npm run typecheck
> tsc -b
(clean, no output)
```

## Acceptance criteria
- [x] `agent_list_commands_request`/`_response` schemas exist, optional-field + `.passthrough()`,
      no existing field narrowed/removed. (verified by reading the diff + green `tsc -b`)
- [x] Both are members of `sessionMessageSchema` and exported from the protocol package index.
      (union entries added; barrel `export *` from `messages.js` needs no change)
- [x] Names are flat snake_case.
- [x] `npm run build:protocol` and `npm run typecheck` pass.

## Follow-ups / TODO(verify)
- None. SDK/CLI/MCP/web-client surfaces are an explicit deferred follow-up per the task's "Out of
  scope" section, not part of this sprint.
