# Live Tool Output Streaming — `tool_execution_update`

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [agent-sessions.md](agent-sessions.md), [agent-providers.md](agent-providers.md),
> [timeline-streaming.md](timeline-streaming.md), [timeline-rendering.md](timeline-rendering.md),
> [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md)

## Purpose

A long-running tool call is **silent dead air** today. Pi emits `tool_execution_update` events
while a tool runs — carrying the *accumulated* partial output so far (`partialResult.content`, not
a delta; Pi `docs/rpc.md` § tool_execution_start/update/end) — but the Pi event mapper
(`packages/server/src/agent/providers/pi/event-mapper.ts`, "Ignored" branch) drops them. The
`ToolCard` for a 2-minute `npm test` shows a bare `running` badge until `tool_execution_end`
lands; the turn is indistinguishable from a hung one.

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
3. **Lossless coalescing.** Because each snapshot is *accumulated* (replace, not append), dropping
   intermediate snapshots loses nothing. The daemon coalesces per `callId` to bound broadcast rate
   and frame size regardless of how fast the tool prints.
4. **A partial never outruns its terminal.** No `partial: true` event for a `callId` may be
   delivered after that call's terminal `tool_call` (`completed`/`error`) — a stale trailing
   snapshot would regress the card's status badge from `completed` back to `running`
   (`onToolCall` derives row status from the latest event).

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
carry the accumulated text under `partialResult`, not `result` (same
`{type: "text", text}`-block join as today). `args` are present on update events, so
command/path/query detail maps exactly as for `tool_execution_start`.

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

on mapped turn terminal (turn_completed / turn_failed / turn_canceled) or session close:
    cancel all pending flushes                           # no partial after turn terminal
```

### Server — persistence policy (`agent-service.ts` runTurn subscriber)

```
on event from session.subscribe:
    if event.kind == "tool_call" and event.partial:
        broadcast agent_stream { agentId, timestamp: now(), event }   # NO timeline.append, NO seq
    else:
        row = timeline.append(event)                                   # unchanged
        broadcast agent_stream { agentId, seq: row.seq, timestamp: row.timestamp, event }
```

The mock provider's shell scenario emits 2–3 `partial: true` snapshots directly — bypassing the
Pi-only coalescer, deterministically and by design — so this branch is smoke-testable without
credentials.

### Client — reducer (`packages/web-client/src/timeline/reducer.ts`)

Two small client-local changes; everything else is existing behavior:

- **Turn-terminal closes open tool rows.** `turn_canceled`/`turn_failed` mark any tool row still
  `"running"` as `"canceled"`/`"error"` — an aborted tool never receives its `tool_execution_end`,
  and a row stuck on `running` would otherwise pin the live tail on screen forever. (This also
  fixes the pre-existing stale-badge defect, which existed before streaming made it prominent;
  `"canceled"` is a new client-local `ToolRow` status with a muted badge.)
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

- While `row.status === "running"` and `tool.output` is non-empty, render a **live output tail**
  below the header even when collapsed: monospace block (existing `toolCode` style), last
  `LIVE_TAIL_LINES = 12` lines, newest at the bottom.
- On terminal status the card returns to its normal presentation (collapsed header-only unless the
  user expanded it); the expanded body shows the full final output as today.
- The virtualized timeline already re-measures rows via `measureElement` and keeps bottom-stick on
  row growth (`Timeline.tsx`) — a growing tail needs no special handling, but the tail block must
  cap its own height (no unbounded card growth) so re-measure cost stays constant.

### Client — CLI (`packages/cli/src/agent-commands.ts`)

`pi-studio agent watch`/`attach` print one line per stream event, so partials would otherwise
print a duplicate `[<kind> running] …` line up to 5×/s for the tool's whole lifetime. Both render
modes skip `partial: true` events entirely (plain text **and** `--json` — the guard sits at the
subscription site, since `--json` bypasses `formatStreamEvent`). The fetch-based `agent log` path
needs no change: partials never appear in fetched pages. Rendering streamed output in the CLI is
explicitly out of scope — the live tail is a web-client affordance.

## Data & Persistence

**None.** Partial events never reach `AgentTimelineStore.append`, the persisted
`AgentRecord.timeline`, provider `history`, or `fetch_agent_timeline_request` pages. A client that
reconnects mid-tool-call sees no output until the next partial (≤200 ms away while the tool
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
| CLI `agent watch`/`attach` mid-stream | Partial events print nothing in either render mode — no duplicate `[… running]` lines |

## Dependencies

- Internal: Pi event mapper + `PiAgentSession` emission path, `agent-service` runTurn subscriber,
  mock provider, web-client timeline reducer + `ToolCard`, CLI `agent watch`/`attach` rendering.
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
- [ ] Mock provider emits partial snapshots in its shell scenario; an end-to-end dev-daemon smoke
      run shows the live tail without Pi credentials.
- [ ] Old-client simulation: applying a partial event through the reducer without any client
      change still merges `output` into the existing row (regression-locks tenet 1).
- [ ] After `turn_canceled`/`turn_failed` while a tool is still `running`, its row's status closes
      (`"canceled"`/`"error"`) and no live tail remains rendered.
- [ ] A terminal `tool_call` whose output is absent/empty clears previously merged partial output —
      the live view converges with what a reload of the persisted timeline shows.
- [ ] `pi-studio agent watch` and `attach` print nothing for partial events, in both plain and
      `--json` modes.

## TODO(verify)

- [ ] `queue_update` is *specified* as never-persisted (timeline-streaming.md) but
      `agent-service.ts`'s subscriber currently appends every non-user event, `queue_update`
      included. Align it with the same ephemeral branch introduced here, or document why it stays.
- [ ] Whether Pi itself already truncates `partialResult` (its `details.truncation` field) tightly
      enough that the 64 KiB daemon-side cap rarely triggers.
- [ ] Exact placement of the coalescer (`PiAgentSession.emit` wrapper vs. a standalone
      `tool-output-coalescer.ts`) — decide at implementation; injectable clock either way.
