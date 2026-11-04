# Live Tool Output Streaming — `tool_execution_update`

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [agent-sessions.md](agent-sessions.md), [agent-providers.md](agent-providers.md),
> [timeline-streaming.md](timeline-streaming.md), [timeline-rendering.md](timeline-rendering.md),
> [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md)

## Purpose

A long-running tool call is **silent dead air** today. Pi emits `tool_execution_update` events
while a tool runs — carrying the partial output so far under `partialResult.content`, not `result`
(Pi 1.4.0 `docs/json.md` § tool events; `dist/core/extensions/types.d.ts`
`ToolExecutionUpdateEvent`) — but the Pi event mapper
(`packages/server/src/agent/providers/pi/event-mapper.ts`, "Ignored" branch) drops them. The
`ToolCard` for a 2-minute `npm test` shows a spinner and a static `output · N lines` strip until
`tool_execution_end` lands; the turn is indistinguishable from a hung one.

> **Spec re-baselined 2026-11-03.** Sprints 059 (chat timeline redesign), 074 (compaction events)
> and 079 (todos) landed after this scope was drafted. The design tenets are unchanged; the
> implementation notes below describe the current tree.

This scope streams that partial output to the chat UI: the tool card shows a live, growing tail of
stdout/result text while the tool runs, converging on the authoritative final output at
completion.

**Design tenets:**

1. **No new event kind.** Partial output rides the existing `tool_call` stream event with
   `status: "running"` and `tool.output` set to the accumulated snapshot, plus one new **optional**
   field `partial: true` (append-only amendment). The web client's existing `mergeTool()` upsert
   (`timeline/reducer.ts`) already replaces `output` with the latest non-empty value — an old
   client renders live output in its expanded card body with **zero changes**, and an old daemon
   simply never sends partials.
2. **Ephemeral, never persisted.** Partial snapshots are live-stream-only, exactly like
   `queue_update` ([timeline-streaming.md](timeline-streaming.md) § Timeline model): broadcast with
   **no `seq`** (`agent_stream.seq` is already optional on the wire), never appended to the
   `AgentTimelineStore`, never returned by `fetch_agent_timeline_request`, never pushed to the
   provider's `history` replay buffer. The persisted timeline record for a tool call stays exactly
   what it is today: start row + end row.
3. **Lossless coalescing for snapshot-style tools.** Pi's `partialResult` contract is per tool:
   "whether it replaces or extends an earlier update depends on that tool's result contract"
   (`json.md`). `bash` — the only tool verified — sends **accumulated** snapshots (replace, not
   append), already self-throttled at 100 ms and self-capped at ~50 KB / 2000 lines. For such
   tools dropping intermediate snapshots loses nothing. The daemon coalesces per `callId` to
   bound broadcast rate and frame size regardless of how fast the tool prints. A delta-style
   custom tool would render its latest chunk instead of the whole output — documented
   degradation, not reconciled in this scope.
4. **A partial never outruns its terminal.** No `partial: true` event for a `callId` may be
   delivered after that call's terminal `tool_call` (`completed`/`error`) — a stale trailing
   snapshot would regress the card's status from `completed` back to `running` **and** its
   `statusText` back to `"running"` (`onToolCall` derives both from the latest event).

## Public Contract

### Protocol amendment (`packages/protocol/src/messages.ts`, append-only)

The `tool_call` branch of `agentStreamEventSchema` gains one optional field:

| Field | Type | Meaning |
|-------|------|---------|
| `partial` | `boolean?` | `true` → ephemeral in-flight output snapshot: not persisted, carries no `seq`, superseded by the next event for the same `callId`. Absent/`false` → unchanged semantics. |

No other schema change. `ToolCallDetail` is untouched — the snapshot travels in the existing
`output` field of every tool kind.

### Pi event mapping (`event-mapper.ts`)

`tool_execution_update` moves from the ignored list to:

| Raw Pi event | → `AgentStreamEvent` |
|--------------|----------------------|
| `tool_execution_update` | `{ kind: "tool_call", callId: toolCallId, tool: mapToolCall(event), status: "running", partial: true }` |

`mapToolCall`'s `outputOf()` must read `result.content ?? partialResult.content` — update events
carry the partial text under `partialResult`, not `result` (same `{type: "text", text}`-block
join as today). `args` are present on update events, so command/path/query detail maps exactly
as for `tool_execution_start`. Non-partial `tool_call` producers are `tool_execution_start`
(`"running"`), `message_update`/`toolcall_end` (`"started"`) and `tool_execution_end`
(`"completed"`/`"error"`); a partial may follow any of them. Nested tool calls (`toolCallId`
`<parent>/<n>`, `parentToolCallId`) flow through unchanged, as their start/end already do.
`bash`'s initial empty update (`content: []`) maps to a partial with no `output` field.

### Wire shape of a partial broadcast

```json
{
  "type": "agent_stream",
  "agentId": "…",
  "timestamp": "…",                    // daemon-owned, as today; NO "seq"
  "event": {
    "kind": "tool_call",
    "callId": "call_abc123",
    "tool": { "kind": "shell", "command": "npm test", "output": "…accumulated tail…" },
    "status": "running",
    "partial": true
  }
}
```

### Coalescing parameters

| Constant | Value | Rationale |
|----------|-------|-----------|
| `PARTIAL_MIN_INTERVAL_MS` | 200 | ≤5 broadcasts/s per tool call; leading + trailing edge |
| `PARTIAL_OUTPUT_CAP_BYTES` | 65536 | Broadcast the **tail** (last 64 KiB) of the snapshot; bounds relay frame size. The end event's authoritative output is not capped by this path (unchanged today). |

## Behavior & Algorithms

### Server — per-`callId` coalescer (Pi provider adapter)

Lives with the Pi adapter (`packages/server/src/agent/providers/pi/`, injectable clock for tests);
chattiness is a provider trait. The mapper stays pure — the coalescer wraps emission in
`PiAgentSession`.

```
on mapped event e for callId c:
    if e.partial:
        do NOT push e into session history               # tenet 2
        if now - lastEmit[c] >= PARTIAL_MIN_INTERVAL_MS:
            emit(e with output tail-capped)              # leading edge
            lastEmit[c] = now
        else:
            pending[c] = e                               # latest snapshot wins
            schedule trailing flush at lastEmit[c] + PARTIAL_MIN_INTERVAL_MS (if not scheduled)
    else if e.kind == "tool_call":                       # any non-partial for c: start / "started" / terminal
        cancel pending flush for c; drop pending[c]      # only a terminal can follow partials (tenet 4)
        push into history; emit(e)                       # unchanged path
    else:
        unchanged path

on mapped turn terminal (turn_completed / turn_failed / turn_canceled) or PiAgentSession.close():
    cancel all pending flushes                           # no partial after turn terminal
```

### Server — persistence policy (`agent-service.ts` `appendStreamEvent`)

`appendStreamEvent` is the single append-and-broadcast rule site (used by `runTurn`'s subscriber
and by `slash-command-operations.ts` for out-of-turn `compaction` events). The ephemeral branch
lives inside it:

```
appendStreamEvent(agentId, event):
    if (event.kind == "tool_call" and event.partial) or event.kind == "queue_update":
        broadcast agent_stream { agentId, timestamp: now(), event }     # NO timeline.append, NO seq
    else:
        row = timeline.append(event)                                   # unchanged
        broadcast agent_stream { agentId, seq: row.seq, timestamp: row.timestamp, event }
```

`queue_update` is folded in because `timeline-streaming.md` specifies it as never persisted / no
`seq`; before this change the code appended it (resolved, see TODO(verify) 1).

The mock provider gains a `#tool` prompt recipe (mirroring `#ui …`/`#todo …`): a `shell` start
row, 2–3 `partial: true` snapshots with growing accumulated output, a `completed` end row, then the
usual echo — bypassing the Pi-only coalescer, deterministically and by design — so this branch is
smoke-testable without credentials. `#tool empty` ends with an empty final output to exercise the
terminal-authority edge. Mock partials bypass the mock's own `history` buffer, mirroring the Pi
coalescer's history exclusion.

### Client — reducer (`packages/web-client/src/timeline/reducer.ts`)

Two small client-local changes; everything else is existing behavior:

- **Turn-terminal closes open tool rows.** `onTurnCanceled`/`onTurnFailed` both route through
  `onTurnCompleted` (= `cancelStartedCompactions(finalizeStreamingRows(state))`), which closes
  streaming prose and `started` compaction rows but **no tool rows**. A new
  `closeRunningTools(state, status)` helper, shaped like `cancelStartedCompactions`, marks any
  tool row still `"running"` as `"canceled"` (cancel) / `"error"` (fail) — an aborted tool never
  receives its `tool_execution_end`, and a row stuck on `running` would otherwise pin the live
  tail on screen forever. It is called from the two terminal handlers, never from
  `onTurnCompleted`. (This also fixes the pre-existing stale-spinner defect; `"canceled"` is a new
  client-local `ToolCallStatus` member rendered as muted trailing text.)
- **The terminal event's `output` is authoritative.** On a `completed`/`error` upsert, `output` is
  taken from the terminal event verbatim — including absent/empty — instead of `mergeTool`'s
  keep-non-empty rule; other fields (command/path/diff) still merge. Without this, an end event
  carrying no result text would leave the last partial's output rendered as final, diverging from
  what a reload of the persisted timeline (start + end rows only) shows.

Unchanged and load-bearing: `onToolCall` upserts by `callId`; while `running`, `mergeTool` replaces
`output` with each incoming non-empty snapshot (accumulated ⇒ replace is correct); `partial` is
not copied onto the row. Invariants preserved:

- `invalidateAfterToolCompletion` (`hooks/agent-stream-events.ts`) fires only on
  `status === "completed"` — partials cause **no** query-cache churn.
- Session title derivation and status transitions ignore partials (status stays `running`).

### Client — `ToolCard` live tail (`features/chat/rows/ToolCard.tsx`)

- The card (post-sprint-059) already shows an `output · N lines` strip whenever `tool.output` is
  non-empty, so the count ticks up live with no change. The tail adds the content.
- While `row.status === "running"` and `tool.output` is non-empty, render a **live output tail**
  as a distinct block between the header and the strip, even when collapsed: monospace block
  (existing `toolCode` style), last `LIVE_TAIL_LINES = 12` lines, newest at the bottom.
- On terminal status the card returns to its normal presentation (header + strip, expanded body
  via `toolBody` if the user opened it); the expanded body shows the full final output as today.
- The virtualized timeline already re-measures rows via `measureElement` and keeps bottom-stick
  on row growth (`Timeline.tsx` + `use-bottom-anchor.ts`) — a growing tail needs no special
  handling, but the tail block must cap its own height (own class, not `.toolBody`'s 420 px) so
  re-measure cost stays constant.

### Client — CLI (`packages/cli/src/agent-commands.ts`)

`pi-studio agent attach` prints one line per stream event, so partials would otherwise
print a duplicate `[<kind> running] …` line up to 5×/s for the tool's whole lifetime. Both render
modes skip `partial: true` events entirely (plain text **and** `--json` — the guard sits at the
subscription site, since `--json` bypasses `formatStreamEvent`). The fetch-based `agent logs` path
needs no change: partials never appear in fetched pages. Rendering streamed output in the CLI is
explicitly out of scope — the live tail is a web-client affordance.

## Data & Persistence

**None.** Partial events never reach `AgentTimelineStore.append`, provider `history` (so never a
post-restart hydration), or `fetch_agent_timeline_request` pages. (`AgentRecord.timeline` on disk
is not a meaningful surface: it is `[]` at create and never written from the store.) A client
that reconnects mid-tool-call sees no output until the next partial (≤200 ms away while the tool
prints) or the end event — acceptable by design.

## Error Handling & Edge Cases

| Condition | Expected behavior |
|-----------|-------------------|
| Trailing flush timer fires after `tool_execution_end` | Must not happen — terminal event cancels the pending flush for that `callId` (tenet 4) |
| Turn aborted / failed mid-tool | Server: the turn terminal cancels all pending flushes. Client: the reducer closes any tool row still `running` (→ `"canceled"`/`"error"`), so no live tail is left pinned by an end event that will never arrive |
| Partial for a `callId` with no prior `tool_execution_start` | `onToolCall` upserts a new row keyed by `callId` — renders correctly; no ordering assumption |
| Snapshot larger than `PARTIAL_OUTPUT_CAP_BYTES` | Broadcast the tail only; final output on the end event is authoritative and unchanged |
| Old client (no `partial` handling) | Ignores the unknown field; merges output into the expanded card body — graceful, no breakage |
| Old daemon (never sends partials) | Client behavior identical to today |
| Non-text `partialResult.content` blocks | Joined text blocks only (existing `outputOf` filter); empty join ⇒ no output field ⇒ snapshot still merges harmlessly |
| Client reconnect mid-tool | No partials in fetched history; live tail resumes on next broadcast |
| Terminal event with absent/empty output after streamed partials | Terminal `output` is authoritative: the reducer takes it verbatim (other fields still merge), so the live view equals a post-reload hydration of the persisted start + end rows |
| CLI `agent attach` mid-stream | Partial events print nothing in either render mode — no duplicate `[… running]` lines |

## Dependencies

- Internal: Pi event mapper + `PiAgentSession` emission path, `agent-service` runTurn subscriber,
  mock provider, web-client timeline reducer + `ToolCard`, CLI `agent attach` rendering.
- Specs: [timeline-streaming.md](timeline-streaming.md) (ephemeral no-`seq` convention),
  [timeline-rendering.md](timeline-rendering.md) (tool-call card contract).

## Acceptance Criteria

- [ ] Given a running shell tool that prints continuously, the client's tool card shows a growing
      output tail while `status` is `running`, updating at most every ~200 ms.
- [ ] `tool_execution_update` maps to `tool_call` with `partial: true`, `status: "running"`, and
      `tool.output` = joined `partialResult` text (verified by mapper unit tests, including the
      `partialResult`-vs-`result` field difference).
- [ ] Partial events are broadcast without `seq` and never appear in
      `fetch_agent_timeline_request` pages or the persisted agent record; the persisted lifecycle
      for a tool call remains start + end rows only.
- [ ] No `partial: true` event for a `callId` is delivered after that call's
      `completed`/`error` event (coalescer cancellation test, including the trailing-edge race).
- [ ] Provider `history` (`streamHistory()`) contains no partial events after a turn with
      streamed output.
- [ ] `invalidateAfterToolCompletion` does not fire for partial events.
- [ ] Snapshots larger than 64 KiB are tail-truncated on the wire; the end event's full output is
      untouched.
- [ ] Mock provider emits partial snapshots via its `#tool` recipe; an end-to-end dev-daemon smoke
      run shows the live tail without Pi credentials.
- [ ] Old-client simulation: applying a partial event through the reducer without any client
      change still merges `output` into the existing row (regression-locks tenet 1).
- [ ] After `turn_canceled`/`turn_failed` while a tool is still `running`, its row's status closes
      (`"canceled"`/`"error"`) and no live tail remains rendered.
- [ ] A terminal `tool_call` whose output is absent/empty clears previously merged partial output —
      the live view converges with what a reload of the persisted timeline shows.
- [ ] `pi-studio agent attach` prints nothing for partial events, in both plain and
      `--json` modes.

## TODO(verify)

- [x] **Resolved — `queue_update` alignment.** `queue_update` was aligned with the ephemeral
      branch: `appendStreamEvent` now broadcasts it with a daemon `timestamp`, no `seq`, and no
      `timeline.append`, matching `timeline-streaming.md`. No existing assertion broke.
- [x] **Resolved — 64 KiB daemon-side cap vs real Pi output.** Live run (2026-11-03, real Pi,
      `global.anthropic.claude-sonnet-5-5` via LiteLLM, a 20-iteration `bash` loop): the largest
      partial snapshot was 151 bytes, so the cap did **not** trigger, consistent with `bash`
      capping its own snapshot at ~50 KB / 2000 lines (`dist/core/tools/truncate.js`). The cap
      stays as protection for unbounded custom tools and is unit-tested in
      `tool-output-coalescer.test.ts`. Observed delivery: 21 partials over 9.5 s (~2.2/s; gaps
      201–503 ms, because `bash` itself emits about every 500 ms for this loop), none carrying a
      `seq`, the terminal event last, no partial after it, final output intact (20 lines).
- [x] **Resolved — interrupt mid-tool.** Stopping a turn during a long `bash` call: real Pi still
      delivers its own `tool_execution_end` (with an error result), so the card closes as `error`
      with the final output, the live tail disappears, a manually expanded card stays expanded, and
      the transcript shows `(canceled)`. The client's `"canceled"` closure (`closeRunningTools`) is
      therefore a safety net for a turn that ends with no end event; it was not exercised live.
- [x] **Resolved — coalescer placement.** A standalone
      `packages/server/src/agent/providers/pi/tool-output-coalescer.ts`
      (`createToolOutputCoalescer`, injected clock/timers), owned by `PiAgentSession` and called
      from its `emit()`; the mapper stays pure.
- [ ] **Still open — non-`bash` delta-style `partialResult`.** Whether any tool other than `bash`
      emits delta-style `partialResult` in practice (Pi's own tools + the curated extension
      packs) is unverified; only `bash` was exercised live. If one does, decide whether the mapper
      should accumulate per `callId` for it or leave the documented degradation (the client then
      renders only the latest chunk).
