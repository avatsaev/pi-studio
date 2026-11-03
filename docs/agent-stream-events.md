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
| `tool_call`          | `callId?`, `tool: ToolCallDetail`, `status?`, `partial?` | Tool invocation start/progress/completion; `partial: true` = ephemeral in-flight output snapshot |
| `turn_started`       | `turnId?`                                        | Turn began                                                                |
| `turn_completed`     | `turnId?`                                        | Turn ended normally                                                      |
| `turn_failed`        | `turnId?`, `error?`                              | Turn ended in error                                                      |
| `turn_canceled`      | `turnId?`                                        | Turn was aborted/interrupted                                             |
| `error`              | `message?`                                       | Non-terminal error surfaced mid-stream                                   |
| `queue_update`       | `steering?: string[]`, `followUp?: string[]`      | Pending steered/follow-up messages changed (**ephemeral**)               |
| `compaction`         | `compactionId`, `phase`, `reason?`, `tokensBefore?`, `estimatedTokensAfter?`, `summary?`, `error?`, `willRetry?` | One context compaction, upserted by `compactionId`; `phase` is `started` → `completed`/`failed`/`canceled` |

`tool_call.status` is a free-form string, not a further-narrowed enum (append-only rule 4 in
`validation-conventions.md`). The Pi provider currently sends `"started"`, `"running"`,
`"completed"`, `"error"`.

## Ephemeral events (no `seq`, never persisted)

Two kinds are live-stream-only: a `tool_call` with `partial: true` (a superseded in-flight output
snapshot — `output` is the tool's accumulated output so far) and `queue_update`. Everything else is
persisted. `appendStreamEvent` (`packages/server/src/agent/agent-service.ts`) is the single rule
site: for these two it broadcasts `agent_stream { agentId, timestamp, event }` with a daemon-owned
`timestamp` and **no `seq`**, and never calls `timeline.append`, so they never appear in
`fetch_agent_timeline_request` pages. All other events are appended and broadcast with
`seq`/`timestamp` from the stored row. That is why `agent_stream.seq` is optional on the wire. The
persisted record of a tool call stays its start row + end row.

Partials are produced from Pi's `tool_execution_update`, whose `partialResult` is a per-tool
contract (replace vs. extend); only `bash` (accumulated snapshots) is verified, so a delta-style
tool would show only its latest chunk. Before broadcast, the Pi provider's
`createToolOutputCoalescer` (`providers/pi/tool-output-coalescer.ts`, called from
`PiAgentSession`'s `emit()`) throttles them per `callId`:

| Constant                   | Value | Effect                                                                        |
| -------------------------- | ----- | ------------------------------------------------------------------------------ |
| `PARTIAL_MIN_INTERVAL_MS`  | 200   | Leading + trailing edge, latest snapshot wins (≤5 partials/s per call)         |
| `PARTIAL_OUTPUT_CAP_BYTES` | 65536 | Wire `output` is tail-capped to the last 64 KiB; the end event is not capped here |

Partials are never recorded in the provider's replay history. Any non-partial event for a `callId`
(including the terminal `completed`/`error`) cancels that call's pending trailing flush, and a turn
terminal or session close cancels all of them, so no partial is delivered after its call's terminal
event.

`assistant_message.final` / `reasoning.final` exist so a renderer can close a block the instant the
model stops writing prose — before the (possibly large) tool-call payload streams, and long before
the terminal `turn_completed`, which can be minutes away. `packages/web-client` renders markdown
live for an open block (per-block, so the cost never scales with message length — see its
`timeline/streaming-split.ts`), and uses these markers to swap that split render for one canonical
full parse, complete with syntax highlighting, diagrams and math.

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
| `agent_settled`                                  | terminal: `turn_canceled` when `aborted: true` (Pi ≥ 1.1.0, wins over the latch); otherwise from the latched disposition: `turn_completed` / `turn_failed` / `turn_canceled` |
| `message_update` (`assistantMessageEvent.type`) |                                                                                              |
| — `text_delta`                                   | `assistant_message` (streaming text)                                                       |
| — `text_end`                                     | `assistant_message` with `final: true`, no text                                            |
| — `thinking_delta`                               | `reasoning` (streaming)                                                                    |
| — `thinking_end`                                 | `reasoning` with `final: true`, no text                                                    |
| — `toolcall_end`                                 | `tool_call` (`status: "started"`)                                                           |
| — `error`                                        | `error`; also latches failed/canceled ahead of the eventual `agent_settled`                |
| `tool_execution_start`                           | `tool_call` (`status: "running"`)                                                           |
| `tool_execution_end`                             | `tool_call` (`status: event.isError ? "error" : "completed"`)                              |
| `tool_execution_update`                          | `tool_call` (`status: "running"`, `partial: true`) — `outputOf` reads `result.content ?? partialResult.content` |
| `compaction_start`                               | `compaction` (`phase: "started"`, fresh `compactionId`)                                     |
| `compaction_end`                                 | `compaction` (`phase: "canceled"` when `aborted`, `"completed"` with a `result`, else `"failed"`), same `compactionId` as the start |
| `queue_update`                                   | `queue_update` (ephemeral)                                                                  |
| `extension_error`                                | `error`                                                                                     |
| `error`                                          | `error`                                                                                     |

`mapToolCall()` in the same file maps a Pi tool payload's `toolName`/`args`/`result` to the
normalized `ToolCallDetail` kind above (matching on `shell`/`bash`/`exec`/`run`,
`read`/`read_file`/`cat`, `edit`/`apply_patch`/`patch`, `write`/`write_file`/`create`,
`search`/`grep`/`glob`, `fetch`/`web_fetch`/`http`, `task`/`agent`/`subagent`); an unrecognized
tool name falls back to `kind: "task"` with the raw name as `description`.

### Ignored Pi events (no `AgentStreamEvent` produced)

`turn_start`, `turn_end`, `message_start`, `message_end`, `auto_retry_start`, `auto_retry_end` —
deliberately dropped, either handled elsewhere or not meaningful as a timeline event. Any other
unrecognized `type`/`kind` also maps to `null` (no event).

## Consumer: the web client

Every `AgentStreamEvent` a session receives passes through one entry point,
`applyAgentStreamEvent()` (`packages/web-client/src/hooks/agent-stream-events.ts`), which does two
things per event:

**1. Timeline rendering (all 11 kinds handled).** Unconditionally calls
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
| `compaction`            | `onCompaction`         |
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
| `compaction`, when `phase === "completed"` with `estimatedTokensAfter` | seeds the post-compaction context estimate in the stats store (live-only) |

So the server's emitted set and the client's consumed set are the **same 11 kinds** — nothing is
emitted and dropped, nothing is expected but never sent. The only asymmetry is that a subset of
kinds *additionally* drives session status/query invalidation, while the rest only drive timeline
row rendering.

**Live tail (partial `tool_call`).** `onToolCall` upserts the tool row by `callId`; while the row is
`"running"`, each incoming non-empty `output` snapshot replaces the previous one (`partial` is not
copied onto the row). `features/chat/rows/ToolCard.tsx` renders a live tail block — the last
`LIVE_TAIL_LINES` (12, `timeline/live-tail.ts`) lines of `output` — whenever the row is `"running"`
and has output, even when collapsed. A terminal `completed`/`error` `tool_call`'s `output` is
authoritative: the reducer takes it verbatim (absent/empty included) rather than keeping the last
partial, so the live view equals a reload of the persisted start + end rows. On `turn_canceled` /
`turn_failed`, any tool row still `"running"` is closed to `"canceled"` (a client-local
`ToolCallStatus`, never on the wire) / `"error"`. Partials never trigger
`invalidateAfterToolCompletion` (it fires only on `status === "completed"`).

**Consumer: the CLI.** `pi-studio agent attach` (`packages/cli/src/agent-commands.ts`)
skips `tool_call` events with `partial: true` entirely, in both plain and `--json` modes (the guard
sits at the subscription site, before the `--json` branch). The fetch-based `agent logs` never sees
partials.

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
5. Decide persisted vs. ephemeral. The default is persisted (appended to the timeline, broadcast
   with `seq`). A live-only kind must be added to the ephemeral condition in `appendStreamEvent`
   (`packages/server/src/agent/agent-service.ts`) — the single rule site — and, if a provider
   emits it in bulk, throttled before it gets there (as `tool-output-coalescer.ts` does for
   partials). Also check the CLI's `agent attach` subscription site, which prints one line
   per received event.
