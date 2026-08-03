# Task 001 — Make Pi turn-settlement drive the terminal stream event

- **Sprint:** sprint-041-agent-turn-settlement
- **Status:** done
- **Estimated size:** M
- **Depends on:** —

## Goal
Stop declaring a Pi turn terminal on the first `agent_end`. Key `turn_completed`/`turn_failed`/
`turn_canceled` off Pi's `agent_settled` event, and treat a non-final `agent_end` (retry,
overflow-compaction, or queued continuation to come) as **non-terminal**.

## Background / why
`event-mapper.ts:101-121` treats **every** `agent_end` as the turn's terminal event. The terminal
*kind* is already derived correctly there from the run's last assistant `stopReason` (`"error"` →
`turn_failed{error}`, `"aborted"` → `turn_canceled`, else `turn_completed`) — that half shipped
earlier and is kept as-is. What is wrong is the *timing*: `willRetry` is read nowhere in the mapper,
and `agent_settled` is not a case at all (it falls through to `default: return null`, and is not even
in the explicit ignore list at `:176-185`). Pi's session run loop
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

Emitting the terminal on the first `agent_end` fires it mid-turn. Downstream in
`agent-service.ts` `runTurn`, the terminal event resolves `session.run()` (`PiAgentSession.run`'s
resolve gate), which triggers `unsubscribe()` — the daemon stops appending/broadcasting stream rows —
then flips status to `idle` and can `archiveAgent()` under `autoArchive`. A retried/continued turn
therefore appears finished mid-flight, its later rows vanish from the timeline, status flips wrong,
and a wrong final outcome is recorded if the retry ultimately fails.

`agent_settled` is bare (no disposition), so the mapper must **latch** the disposition the
`agent_end` case already computes (`event-mapper.ts:109-120`) and emit the right terminal kind at
settle — the same refinement `session-hydration.ts:158-170` applies to replayed history (`turnCloser`
= `turn_completed`, or `turn_failed`/`turn_canceled` per closing `stopReason`).

## Scope references
- `packages/server/src/agent/providers/pi/event-mapper.ts` (`mapPiEvent`; the `agent_end` /
  `agent_settled` / `message_update` cases)
- `packages/server/src/agent/providers/pi/agent.ts` (`PiAgentSession` constructor `transport.onEvent`
  hook `:143` — the only production caller of `mapPiEvent`; `run()` resolve gate `:227-241`)
- `packages/server/src/agent/providers/pi/session-hydration.ts` (`:129-170` — existing `stopReason`
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
   shim (delegates to a fresh instance) so the ~10 existing single-event assertions on stateless
   events (`agent_start`, `message_update`, `tool_execution_start|end`, `queue_update`, unknown
   types) keep working unchanged. The shim can no longer report a terminal — through it `agent_end`
   returns `null` — so every terminal assertion moves to the stateful form (§ Test plan).
   `mapToolCall` is a separate export with its own callers and is untouched.
2. Track one field, `disposition: "completed" | "failed" | "canceled"` (+ optional `error` string),
   reset to `"completed"` at each `turn_started` (`agent_start`) or after emitting a terminal:
   - `agent_start` → `turn_started` (and reset disposition).
   - `agent_end`: if `willRetry === true` → return `null` (non-terminal). Otherwise **latch** the
     disposition using the logic already at `event-mapper.ts:109-120` (move it into the latch, do not
     rewrite it): last assistant message in `messages[]` (`stopReason`: `"error"`→failed with
     `errorMessage` falling back to `"error"`; `"aborted"`→canceled; else completed) — and still
     return `null`.
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
- `agent-service.ts` — its terminal handling is already correct given a correct terminal event; do
  not change it (`runTurn` `:243-353`; `unsubscribe()` `:328`, `newStatus` `:333-334`, `autoArchive`
  → `archiveAgent` `:343-352`).
- The permission/extension-UI bridge and thinking-level gaps (unrelated audit findings).
- Protocol schema (reuses existing terminal kinds — append-only untouched).

## Acceptance criteria
- [ ] A non-final `agent_end` (`willRetry:true`, or followed by more runs before `agent_settled`)
      maps to `null`; no terminal is emitted until `agent_settled`.
- [ ] `agent_settled` emits exactly one terminal event with the correct kind: `turn_completed` for a
      clean run, `turn_failed{error}` when the settled run's last assistant `stopReason` is `"error"`,
      `turn_canceled` when `"aborted"`.
- [ ] The three existing `stopReason` mapper tests (provider-429 → `turn_failed`, `"aborted"` →
      `turn_canceled`, clean → `turn_completed`) still assert those dispositions, rewritten to latch
      on `agent_end` and assert the terminal after `agent_settled` — not deleted.
- [ ] A retry sequence (`agent_end{willRetry:true}` → … → `agent_end{willRetry:false}` →
      `agent_settled`) yields exactly one `turn_completed`.
- [ ] `PiAgentSession.run()` resolves at `agent_settled`, not the interim `agent_end`.
- [ ] `npm run build:server` and `npm run typecheck` pass.

## Test / verification plan
- Unit (`packages/server/src/agent/providers/pi/pi-adapter.test.ts`, event-mapper block). **Four**
  existing terminal assertions must be rewritten to the settled form (latch on `agent_end`, assert
  the terminal after `agent_settled`); none may be dropped:
  - `:267` — the inline `mapPiEvent({type:"agent_end"}) → turn_completed` inside "maps real Pi events
    and ignores unknown ones"
  - `:278-299` — "maps agent_end with a failed final assistant message to turn_failed (real repro:
    provider 429)"; preserve the 429 regression intent
  - `:301-308` — "maps agent_end with an aborted final assistant message to turn_canceled"
  - `:310-319` — "maps agent_end with a clean final assistant message to turn_completed"
  Then add the new retry case: `agent_end{willRetry:true}` → `null`, further rows, a final
  `agent_end{willRetry:false}`, then `agent_settled` → exactly one `turn_completed`.
  `npx vitest run packages/server/src/agent/providers/pi/pi-adapter.test.ts`.
- Adapter wiring + fake-transport update and the agent-service regression test live in task-002.

## Notes
- Disposition source of truth is `agent_end.messages[]`'s last assistant `stopReason` (authoritative,
  always present); the streaming `done` delta is not needed as a secondary latch.
- Reset disposition on `turn_started` so a fresh turn on a reused session never inherits the prior
  turn's outcome.
