# Agent stream events

`AgentStreamEvent` is the provider-neutral event union the daemon broadcasts while an agent turn
runs — streamed text/thinking deltas, tool calls, and turn lifecycle transitions. It is the
payload of the `agent_stream` session message (`type: "agent_stream"`, wrapping `agentId`, `seq`,
`timestamp`, and `event`) and is also what a hydrated/replayed session timeline is built from
(`fetch_agent_timeline_request`). The schema lives in `packages/protocol/src/messages.ts` and is
**append-only** (root `AGENTS.md` invariant 1): existing kinds/fields are never removed or
narrowed, so an old client silently ignoring a new kind is a supported, expected behavior — see
`timeline/reducer.ts`'s `default` branch below.

## Wire event kinds — `AgentStreamEvent`

Discriminated on `kind` (`agentStreamEventSchema`, `messages.ts:258-305`). This is the **complete**
set the server can emit today:

| `kind`             | Fields                                          | Meaning                                                                 |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------ |
| `user_message`      | `messageId?`, `text?`, `images?`                  | Echo of a submitted user prompt                                          |
| `assistant_message` | `messageId?`, `text?`, `final?`                   | Streaming assistant text delta; `final: true` closes the block, no text  |
| `reasoning`          | `text?`, `final?`                                | Streaming thinking delta; `final: true` closes the block, no text        |
| `tool_call`          | `callId?`, `tool: ToolCallDetail`, `status?`      | Tool invocation start/progress/completion                                |
| `turn_started`       | `turnId?`                                        | Turn began                                                                |
| `turn_completed`     | `turnId?`                                        | Turn ended normally                                                      |
| `turn_failed`        | `turnId?`, `error?`                              | Turn ended in error                                                      |
| `turn_canceled`      | `turnId?`                                        | Turn was aborted/interrupted                                             |
| `error`              | `message?`                                       | Non-terminal error surfaced mid-stream                                   |
| `queue_update`       | `steering?: string[]`, `followUp?: string[]`      | Pending steered/follow-up messages changed                               |

`tool_call.status` is a free-form string, not a further-narrowed enum (append-only rule 4 in
`validation-conventions.md`). The Pi provider currently sends `"started"`, `"running"`,
`"completed"`, `"error"`.

`assistant_message.final` / `reasoning.final` exist so a renderer can switch a block from a cheap
streaming tier to full markdown the instant the model stops writing prose — before the (possibly
large) tool-call payload streams, and long before the terminal `turn_completed`, which can be
minutes away.

## `ToolCallDetail` — nested union

`tool_call.tool` is itself a discriminated union, normalized across providers
(`toolCallDetailSchema`, `messages.ts:225-254`):

| `kind`   | Fields                          |
| -------- | -------------------------------- |
| `shell`  | `command?`, `output?`            |
| `read`   | `path?`, `output?`               |
| `edit`   | `path?`, `diff?`, `output?`      |
| `write`  | `path?`, `output?`               |
| `search` | `query?`, `output?`              |
| `fetch`  | `url?`, `output?`                |
| `task`   | `description?`, `output?`        |

`output` is only populated on the *end* event of a tool call (`tool_execution_end`) — the *start*
event has no result yet.

## Producer: the Pi provider mapper

`packages/server/src/agent/providers/pi/event-mapper.ts` (`createPiEventMapper`/`mapPiEvent`) is
the only producer today. It is **stateful**: it latches a turn's disposition off each low-level
`agent_end` and only emits the terminal `AgentStreamEvent` when Pi's `agent_settled` arrives —
Pi's run loop emits one `agent_end` per low-level run (a retryable error, compaction retry, or a
queued steering/follow-up message all loop into another run before the turn is actually done), so
`agent_end` is a per-run boundary, not the turn's terminal.

| Raw Pi event                                   | → `AgentStreamEvent`                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `agent_start`                                    | `turn_started`                                                                             |
| `agent_end`                                      | *(none)* — latches disposition from the last assistant message's `stopReason` (`error`→failed, `aborted`→canceled, else completed); swallowed entirely when `willRetry: true` |
| `agent_settled`                                  | terminal, from the latched disposition: `turn_completed` / `turn_failed` / `turn_canceled`  |
| `message_update` (`assistantMessageEvent.type`) |                                                                                              |
| — `text_delta`                                   | `assistant_message` (streaming text)                                                       |
| — `text_end`                                     | `assistant_message` with `final: true`, no text                                            |
| — `thinking_delta`                               | `reasoning` (streaming)                                                                    |
| — `thinking_end`                                 | `reasoning` with `final: true`, no text                                                    |
| — `toolcall_end`                                 | `tool_call` (`status: "started"`)                                                           |
| — `error`                                        | `error`; also latches failed/canceled ahead of the eventual `agent_settled`                |
| `tool_execution_start`                           | `tool_call` (`status: "running"`)                                                           |
| `tool_execution_end`                             | `tool_call` (`status: event.isError ? "error" : "completed"`)                              |
| `queue_update`                                   | `queue_update`                                                                              |
| `extension_error`                                | `error`                                                                                     |
| `error`                                          | `error`                                                                                     |

`mapToolCall()` in the same file maps a Pi tool payload's `toolName`/`args`/`result` to the
normalized `ToolCallDetail` kind above (matching on `shell`/`bash`/`exec`/`run`,
`read`/`read_file`/`cat`, `edit`/`apply_patch`/`patch`, `write`/`write_file`/`create`,
`search`/`grep`/`glob`, `fetch`/`web_fetch`/`http`, `task`/`agent`/`subagent`); an unrecognized
tool name falls back to `kind: "task"` with the raw name as `description`.

### Ignored Pi events (no `AgentStreamEvent` produced)

`turn_start`, `turn_end`, `message_start`, `message_end`, `tool_execution_update`,
`compaction_start`, `compaction_end`, `auto_retry_start`, `auto_retry_end` — deliberately dropped,
either handled elsewhere or not meaningful as a timeline event. Any other unrecognized `type`/`kind`
also maps to `null` (no event).

## Consumer: the web client

Every `AgentStreamEvent` a session receives passes through one entry point,
`applyAgentStreamEvent()` (`packages/web-client/src/hooks/agent-stream-events.ts`), which does two
things per event:

**1. Timeline rendering (all 10 kinds handled).** Unconditionally calls
`sessionStore.applyStreamEvent()`, which forwards straight into
`timeline/reducer.ts`'s `applyStreamEvent()` — every kind has an explicit case:

| `kind`               | Reducer function      |
| --------------------- | ---------------------- |
| `turn_started`         | `onTurnStarted`        |
| `user_message`         | `onUserMessage`        |
| `assistant_message`    | `onAssistantMessage`   |
| `reasoning`             | `onReasoning`          |
| `tool_call`             | `onToolCall`           |
| `turn_completed`        | `onTurnCompleted`      |
| `turn_failed`           | `onTurnFailed`         |
| `turn_canceled`         | `onTurnCanceled`       |
| `error`                 | `onError`              |
| `queue_update`          | `onQueueUpdate`        |
| *(unknown/future kind)* | no-op — append-only tolerance |

**2. Side effects beyond rendering (a subset of kinds).** `applyAgentStreamEvent()`'s own switch
additionally drives session status and query-cache invalidation:

| `kind`                                                        | Side effect                                                              |
| --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `turn_started`                                                   | session status → `"running"`                                               |
| `turn_completed`                                                  | session status → `"idle"`                                                  |
| `turn_failed`                                                     | session status → `"error"`                                                 |
| `turn_canceled`                                                   | session status → `"idle"`                                                  |
| `tool_call`, when `status === "completed"` and the tool mutates files | invalidates file/diff/changes queries (`invalidateAfterToolCompletion`) |
| `user_message`, `assistant_message`, `reasoning`, `error`, `queue_update` | none here — fully handled by the reducer above, no extra side effect  |

So the server's emitted set and the client's consumed set are the **same 10 kinds** — nothing is
emitted and dropped, nothing is expected but never sent. The only asymmetry is that a subset of
kinds *additionally* drives session status/query invalidation, while the rest only drive timeline
row rendering.

### Timeline rows (client-local render model, not wire events)

The reducer above folds `AgentStreamEvent`s into `TimelineRow`s
(`packages/web-client/src/timeline/row-model.ts`), rendered by `Timeline.tsx`:

| Row `kind`  | Rendered by      | Produced from                                                    |
| ------------ | ----------------- | -------------------------------------------------------------------- |
| `user`        | `UserRow`          | `user_message`                                                        |
| `assistant`   | `AssistantRow`     | `assistant_message`                                                   |
| `reasoning`   | `ReasoningRow`     | `reasoning`                                                            |
| `tool`        | `ToolCard`         | `tool_call`                                                            |
| `error`       | `ErrorRow`         | `error`                                                                |
| `system`      | `SystemRow`        | client-local synthetic row only — e.g. `onTurnCanceled` appends a `(canceled)` marker; never sent over the wire |

`ToolCard` renders all 7 `ToolCallDetail` kinds via `toolDetailText()` (`row-model.ts`): `shell` →
`command`, `read`/`write`/`edit` → `path`, `search` → `query`, `fetch` → `url`, `task` →
`description`.

## Adding a new event kind

1. Add the new `kind` as an additional branch to `agentStreamEventSchema` in
   `packages/protocol/src/messages.ts` — **never** remove or narrow an existing branch
   (`validation-conventions.md`).
2. Emit it from a provider mapper (e.g. `event-mapper.ts` for Pi) or wherever else it originates.
3. Add an explicit case to `timeline/reducer.ts`'s `applyStreamEvent()` — the `default` branch
   means an unhandled kind is silently dropped by an *old* client, not a bug, but a *new* kind
   needs its own row-producing case to actually render.
4. Add a case to `hooks/agent-stream-events.ts` only if the kind needs a session-status or
   query-cache side effect beyond rendering a row.
