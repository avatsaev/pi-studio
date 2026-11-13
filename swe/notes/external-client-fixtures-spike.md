# Spike — external-client fixtures: what the dev daemon actually emits

Sprint 083, task-001. Source of truth for tasks 002–006. Captured with
`node packages/server/scripts/record-external-fixtures.ts` (after `npm run build:server`) against
`startDevDaemon({host:"127.0.0.1", port:0, mockTurnDelayMs:150})`. Each fixture's final frame is
committed under `packages/protocol/fixtures/external-clients/`; this note only records producers,
volatile pointers and decisions.

## Producer per stage 1 row

Pointers are relative to `frame`. Common volatile for any agent-scoped frame: `/message/agentId`
(or `/message/payload/agentId`), `/message/requestId`, `/message/timestamp`.

| Fixture | Producer | Notes / extra volatile |
|---|---|---|
| `hello` | client-authored | n/a (client→server) |
| `status.server_info` | handshake, normal | `/payload/serverId`, `/payload/hostname`, `/payload/version`, `/payload/homeDir`. Dev `version` is `"0.1.0-dev"` (the spec's `"1.0.0"` is wrong); `capabilities` is `{}`. `features` is a boolean map; the fixture pins only keys that are stable. |
| `ping` | client-authored | n/a |
| `pong` | normal | **top-level**, not session-wrapped: `{type:"pong",requestId,clientSentAt,serverReceivedAt,serverSentAt}` (`ws/router.ts`). Volatile: all three timestamps and `requestId`; timestamps are epoch ms numbers. |
| `list_agents_request` | client-authored | n/a |
| `list_agents_response` | normal (non-empty after create) | Dev and production (`bootstrap.ts:373`) build **identical field sets**: `agentId,status,title,cwd,labels,lastActivity,provider,model,modelProvider?,thinkingLevel`. `modelProvider` is absent for the mock (undefined → dropped by JSON), so it is not in the fixture. `lastActivity` epoch ms. No finding to report. |
| `agent_update` (`status`, `labels`, `title`, bare `compacted`) | normal | `agent_update` is a family; fixture `agent_update` = `{agentId,status}` |
| `agent_update.model` | normal, **only on a session-less (deferred draft) agent** | `{agentId,model,modelProvider}`. The live-session path throws `unsupported` on the mock (no `setProviderModel`). Create the agent without `initialPrompt`, then `agent_set_model_request`. Dev daemon does emit it. |
| `agent_status` | **no daemon producer anywhere** | Schema exists (`agentStatusMessageSchema`) but nothing in server code emits it. Decision: Layer-A-only **exception**, documented in the manifest and README. It has a Zod schema, so the "schema-less cannot be exception" rule is satisfied. |
| `agent_archived`, `agent_deleted` | normal (`archive_agent` / `delete_agent`) | `archivedAt` ISO string volatile |
| `agent_stream.user_message` / `.assistant_message` / `.turn_started` / `.turn_completed` | normal (`create_agent_request` with `initialPrompt`) | `seq` number, `timestamp` ISO string (**ISO, not epoch**), ids volatile |
| `agent_stream.tool_call`, `.tool_call.partial` | normal (`#tool shell` prompt) | partial has **no `seq`**; `callId` volatile |
| `agent_stream.compaction` | normal (`agent_compact_request`, ~1.5 s) | first frame is `phase:"started"`, `reason:"manual"`; `agent_update {compacted:true}` follows |
| `agent_stream.turn_canceled` | normal, but `send_agent_prompt` blocks until the turn ends, so the prompt must be sent as a raw frame, then `interrupt_agent` | needs `mockTurnDelayMs` ≥ ~150 ms |
| `agent_stream.reasoning`, `.turn_failed`, `.error` | **missing mock recipe** | no mock path emits them (an unknown `#stream` prompt is just echoed). Decision (task-002): add `#stream reasoning|fail|error` recipe to the mock provider. |
| `agent_timeline_reset` | **test hook** | `handleFork` only broadcasts when the persistence handle changes; mock fork never changes it. Decision (task-002): mock `fork("mock-rebind")` rebinds its native handle so the real broadcast path runs. No production code change. Frame: `{type:"agent_timeline_reset",agentId,reason:"fork"}` inside the session envelope. |
| `fetch_agent_timeline_request` / `_response` | normal | response `items` mixes `kind:"other"` rows and `kind:"assistant"` groups; fixture holds one representative. `seqStart/seqEnd/hasNewer/collapsed/sourceSeqRanges` literal-typed. |
| `agent_session_stats_request` / `_response` | normal; **registered in the dev daemon** | Dev payload is `{sessionId,totalMessages,tokens:{total},model}`. Production (Pi) adds `sessionFile`, `userMessages`, …; the fixture pins only the dev-stable subset (additive). |
| `interrupt_agent` / `interrupt_response` | normal | `{type:"interrupt_response",agentId,ok}` inside the session envelope, plus `requestId` stamped by the router |
| `rpc_error` | normal (unknown type with `requestId`) | `{requestId,code:"unknown_message_type",message:"no handler for <type>"}` — `message` volatile |
| `agent_ui_request.*` | `MockAgentSession.emitUiRequest` via `dev.manager` | `createdAt` epoch **ms number**; `requestId` daemon-minted |
| `agent_ui_resolved.answered` / `.timeout` | normal | `timeout` needs `timeoutMs` on the request |
| `agent_ui_resolved.cancelled` | **no daemon producer** | The daemon only ever broadcasts `answered` (respond, even with `{cancelled:true}`), `timeout` and `aborted` (archive/delete/re-attach sweep). `reason` is an open string and the spec lists `cancelled`, so the fixture is a Layer-A-only **exception** (has a Zod schema). |
| `agent_ui_resolved.aborted` | normal (archive/delete with a pending dialog) | confirmed in the final recorder run |
| `agent_ui_respond_request` / `_response` (`ok`, `not_found`) | normal | response: `{payload:{ok:true}}` / `{payload:{ok:false,error:"not_found"}}` |
| `agent_ui_list_request` / `_response` | normal | `payload.pending[]` + `payload.surfaces[]`; `createdAt`/`updatedAt` epoch ms |
| `health` | normal HTTP | `GET /api/health` → `200`, `content-type: application/json`, body `{"status":"ok"}` |

Permission rows (`agent_permission_*`, `agent.permission.respond.*`) are dropped: the channel was
retired in sprint-086; no dev-handle hook is added.

## Answers to the spec's five TODO(verify)

1. **`fixtures/` in npm `files`: yes.** The directory is small static JSON; shipping it lets
   external clients pin by published version in addition to a git commit. Task-007 adds it.
2. **Stream events scriptable on the mock:** `user_message`, `assistant_message`, `turn_started`,
   `turn_completed`, `turn_canceled`, `tool_call`(+`partial`), `compaction` — yes. `reasoning`,
   `turn_failed`, `error` — no; a `#stream` recipe (task-002) adds them through the normal turn
   loop. `error`/`turn_failed` flip the agent status to `error` (agent-service), which is correct.
3. **`agent_timeline_reset` producer:** a mock fork that rebinds its native handle (task-002).
   Evidence: `slash-command-operations.ts` `handleFork` guards on `handleAfter !== handleBefore`.
4. **`list_agents_response` / `agent_session_stats_response` field sets:** list is identical in
   dev and production; stats differ (dev subset above). Fixtures record the dev subset; real Pi
   fields are additive.
5. **`pong` and `/api/health`:** see table. `pong` is top-level; health body is `{"status":"ok"}`.

## Other findings

- `agent_status` has no producer anywhere in the daemon.
- `status.server_info.payload.features` now includes `daemonStatusRpc` etc.; fixtures must not pin
  feature keys that are flag-dependent.
- `interrupt_agent` and `list_agents_request` have no entry in `sessionMessageSchema`; Layer B is
  their only guard.
