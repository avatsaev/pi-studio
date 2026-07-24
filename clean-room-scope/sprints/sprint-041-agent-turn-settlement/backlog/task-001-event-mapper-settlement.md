# Task 001 — Make Pi turn-settlement drive the terminal stream event

- **Sprint:** sprint-041-agent-turn-settlement
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** —

## Goal
Stop declaring a Pi turn terminal on the first `agent_end`. Key `turn_completed`/`turn_failed`/
`turn_canceled` off Pi's `agent_settled` event, and treat a non-final `agent_end` (retry,
overflow-compaction, or queued continuation to come) as **non-terminal**.

## Background / why
`event-mapper.ts` maps every `agent_end → turn_completed` unconditionally. But Pi's session run loop
(`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js` `_runAgentPrompt`) emits
one `agent_end` **per low-level run** and exactly one `agent_settled` at the true end:

```
agent.prompt(messages)            // agent_start … agent_end (run #1)
while (_handlePostAgentRun())     // retryable error / overflow-compaction / queued msg?
    agent.continue()              // agent_start … agent_end (run #2, #3, …)
finally: _emitAgentSettled()      // agent_settled — once, terminal
```

Each `agent_end` is decorated with `willRetry` (`agent-session.js` `_handleAgentEvent` /
`_willRetryAfterAgentEnd`): `true` when auto-retry is enabled, the attempt budget isn't exhausted,
and the last assistant message carries a retryable error. Overflow-compaction and queued
steering/follow-up continuations also loop before `agent_settled` (docs/rpc.md § `agent_end` /
§ `agent_settled`: *"agent_settled … Pi will not continue automatically through retry, compaction
retry, or queued follow-up messages"*).

Mapping the first `agent_end → turn_completed` fires terminal mid-turn. Downstream in
`agent-service.ts` `runTurn`, the terminal event resolves `session.run()` (`PiAgentSession.run`'s
resolve gate), which triggers `unsubscribe()` — the daemon stops appending/broadcasting stream rows —
then flips status to `idle` and can `archiveAgent()` under `autoArchive`. A retried/continued turn
therefore appears finished mid-flight, its later rows vanish from the timeline, status flips wrong,
and a wrong final outcome is recorded if the retry ultimately fails.

`agent_settled` is bare (no disposition), so the mapper must remember the last run's disposition
(from the final `agent_end`'s assistant `stopReason`, or a streaming `error` delta) and emit the
right terminal kind at settle — the same refinement `session-hydration.ts` already does for replayed
history (`turnCloser` = `turn_completed`, or `turn_failed`/`turn_canceled` per closing
`stopReason`).

## Scope references
- `packages/server/src/agent/providers/pi/event-mapper.ts` (`mapPiEvent`; the `agent_end` /
  `agent_settled` / `message_update` cases)
- `packages/server/src/agent/providers/pi/agent.ts` (`PiAgentSession` constructor `transport.onEvent`
  hook; `run()` resolve gate `:195-209`)
- `packages/server/src/agent/providers/pi/session-hydration.ts` (`:130-168` — existing `stopReason`
  → closer refinement to mirror: `"error"`→`turn_failed{error}`, `"aborted"`→`turn_canceled`)
- Pi RPC contract: `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md` § Events
  (`agent_end` with `messages[]`/`willRetry`, `agent_settled`, `message_update` `done`/`error`
  deltas); `dist/core/agent-session.js` (`_runAgentPrompt`, `_willRetryAfterAgentEnd`,
  `_emitAgentSettled`)
- `packages/protocol/src/messages.ts` (`agentStreamEventSchema` — reuse existing `turn_completed`/
  `turn_failed{error?}`/`turn_canceled`; **no schema change**)
- `packages/server/AGENTS.md` § Provider isolation

## What to build
1. Convert the stateless `mapPiEvent` into a stateful mapper — `createPiEventMapper()` returning
   `{ map(raw): AgentStreamEvent | null }` (closure factory). Keep a thin stateless `mapPiEvent`
   shim (delegates to a fresh instance) so existing single-event unit assertions and `mapToolCall`
   callers keep working.
2. Track one field, `disposition: "completed" | "failed" | "canceled"` (+ optional `error` string),
   reset to `"completed"` at each `turn_started` (`agent_start`) or after emitting a terminal:
   - `agent_start` → `turn_started` (and reset disposition).
   - `agent_end`: if `willRetry === true` → return `null` (non-terminal). Otherwise **latch**
     disposition from the last assistant message in `messages[]` (`stopReason`: `"error"`→failed
     with `errorMessage`; `"aborted"`→canceled; else completed) and still return `null`.
   - `message_update` `assistantMessageEvent.type === "error"` → latch (`reason:"aborted"`→canceled,
     else failed with the reason) — the streaming-error path that can precede `agent_end`.
   - `agent_settled` → emit the latched terminal (`turn_completed`, or `turn_failed{error}` /
     `turn_canceled`), then reset.
   - All other cases unchanged; `extension_error`/bare `error` remain non-terminal `error` events
     (they no longer double as the closer).
3. In `PiAgentSession`, instantiate `createPiEventMapper()` once per session and call `mapper.map(raw)`
   in the constructor's `transport.onEvent` hook instead of `mapPiEvent(raw)`. `run()`'s resolve
   gate is unchanged in logic (resolves on the terminal kinds) — it now only resolves at
   `agent_settled`, which is the fix.

## Out of scope
- Surfacing `auto_retry_*` / `compaction_*` / `summarization_retry_*` as timeline events — they stay
  ignored (would need new protocol `kind`s; separate feature).
- `agent-service.ts` — its terminal handling (`:270-291`) is already correct given a correct
  terminal event; do not change it.
- The permission/extension-UI bridge and thinking-level gaps (unrelated audit findings).
- Protocol schema (reuses existing terminal kinds — append-only untouched).

## Acceptance criteria
- [ ] A non-final `agent_end` (`willRetry:true`, or followed by more runs before `agent_settled`)
      maps to `null`; no terminal is emitted until `agent_settled`.
- [ ] `agent_settled` emits exactly one terminal event with the correct kind: `turn_completed` for a
      clean run, `turn_failed{error}` when the settled run's last assistant `stopReason` is `"error"`,
      `turn_canceled` when `"aborted"`.
- [ ] A retry sequence (`agent_end{willRetry:true}` → … → `agent_end{willRetry:false}` →
      `agent_settled`) yields exactly one `turn_completed`.
- [ ] `PiAgentSession.run()` resolves at `agent_settled`, not the interim `agent_end`.
- [ ] `npm run build:server` and `npm run typecheck` pass.

## Test / verification plan
- Unit (`packages/server/src/agent/providers/pi/pi-adapter.test.ts`, event-mapper block): rewrite
  the `agent_end → turn_completed` assertion to the settled form; add cases for retry
  (`willRetry:true` → `null`, then `agent_settled` → single `turn_completed`), error disposition
  (`stopReason:"error"` → `turn_failed` carrying the message), and aborted (`stopReason:"aborted"` →
  `turn_canceled`). `npx vitest run packages/server/src/agent/providers/pi/pi-adapter.test.ts`.
- Adapter wiring + fake-transport update and the agent-service regression test live in task-002.

## Notes
- Disposition source of truth is `agent_end.messages[]`'s last assistant `stopReason` (authoritative,
  always present); the streaming `done` delta is not needed as a secondary latch.
- Reset disposition on `turn_started` so a fresh turn on a reused session never inherits the prior
  turn's outcome.
