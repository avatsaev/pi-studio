# Task 001 — Make Pi turn-settlement drive the terminal stream event — Summary

- **Sprint:** sprint-041-agent-turn-settlement
- **Completed:** 2026-08-03
- **Status:** done

## What was implemented
`event-mapper.ts` was converted from a stateless `mapPiEvent(raw)` function into a stateful
`createPiEventMapper()` factory that returns `{ map(raw) }`. The stateful mapper tracks one field,
`disposition: "completed" | "failed" | "canceled"` (+ optional `error`), reset at each `agent_start`
and after emitting a terminal:

- `agent_start` → `turn_started`, resets disposition.
- `agent_end`: if `willRetry === true` → `null` (non-terminal — Pi is about to run again). Otherwise
  latches the disposition from the run's final assistant message `stopReason`
  (`"error"`→failed+`errorMessage`, `"aborted"`→canceled, else completed) — moved verbatim from the
  old inline logic — and still returns `null`. An `agent_end` is now always a per-run boundary, never
  the turn's terminal.
- `message_update` with `assistantMessageEvent.type === "error"` (the streaming-error path that can
  precede `agent_end`) also latches the disposition, in addition to still returning the existing
  non-terminal `{kind:"error", message}` event — unchanged external shape, now also load-bearing for
  disposition in case a later settle lacks a clear `stopReason`.
- `agent_settled` → emits the latched terminal (`turn_completed` / `turn_failed{error}` /
  `turn_canceled`), then resets disposition to `"completed"`.
- All other cases (streaming deltas, tool execution, queue updates, `extension_error`/bare `error`,
  the ignore list) are unchanged.

`mapPiEvent(raw)` is kept as a thin stateless shim — `createPiEventMapper().map(raw)` on a **fresh**
instance per call — preserving the ~10 existing single-event assertions (`agent_start`,
`message_update`, `tool_execution_start|end`, `queue_update`, unknown types) unchanged. Through the
shim, `agent_end` now returns `null` (a lone call never has prior latched state to report), so every
terminal assertion moved to the stateful form.

`PiAgentSession` (`agent.ts`) now instantiates `createPiEventMapper()` once per session
(`private readonly eventMapper`) and calls `this.eventMapper.map(raw)` in the constructor's
`transport.onEvent` hook instead of the old stateless `mapPiEvent(raw)`. `run()`'s resolve gate
(`agent.ts:227-241`) is logically unchanged — it still resolves on `turn_completed`/`turn_failed`/
`turn_canceled` — but those kinds are now only ever emitted at `agent_settled`, which is the fix: a
retried/continued turn no longer resolves `session.run()` (and with it `agent-service.ts`'s
`unsubscribe()`/status-flip/`autoArchive`) mid-turn.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/providers/pi/event-mapper.ts` | modified — stateful `createPiEventMapper()` + `PiEventMapper` type; `mapPiEvent` now a stateless shim over it |
| `packages/server/src/agent/providers/pi/agent.ts` | modified — `PiAgentSession` holds one `eventMapper` per session, wired into `transport.onEvent` |
| `packages/server/src/agent/providers/pi/pi-adapter.test.ts` | modified — rewrote the 4 existing terminal-mapper assertions to the settled form (latch on `agent_end`, assert terminal after `agent_settled`); added a retry-sequence test (`willRetry:true` → another run → `willRetry:false` → `agent_settled` → exactly one `turn_completed`); also carries the sprint's originally-requested bug-confirming regression tests (`describe("sprint-041 regression: …")`, added in a prior turn), which now pass against the fix |

## How it satisfies the scope
Matches `task-001-event-mapper-settlement.md` § What to build items 1–3 exactly: stateful mapper
factory + stateless shim (item 1), `willRetry`/latch/`agent_settled` state machine (item 2),
`PiAgentSession` wiring (item 3). `mapToolCall` was left untouched (separate export, separate
callers) — out of scope per the task. No protocol schema change — reuses the existing `turn_completed`/
`turn_failed{error?}`/`turn_canceled` kinds, as required.

## Build & test results
```
$ npx vitest run packages/server/src/agent/providers/pi/pi-adapter.test.ts -t "event mapper"
✓ 13 passed | 36 skipped (49)

$ npm run build:server
tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js   → success, no errors

$ npm run typecheck
tsc -b   → success, no errors

$ npx oxlint packages/server/src/agent/providers/pi/event-mapper.ts packages/server/src/agent/providers/pi/agent.ts packages/server/src/agent/providers/pi/pi-adapter.test.ts
(no output — clean)
```
Note: the full `pi-adapter.test.ts` file has 4 pre-existing failures after this change
(`PiAgentClient > createSession …`, `PiAgentClient > interrupt …`, and two `slash-prompt turn
completion` tests) — expected and explicitly deferred to task-002 per this task's own test plan
("Adapter wiring + fake-transport update and the agent-service regression test live in task-002"):
`FakeTransport`'s scripted `prompt`/`abort` event sequences still end on a bare `agent_end` with no
`agent_settled`, so `run()` now never resolves against them. Task-002 fixes the fixture.

## Acceptance criteria
- [x] A non-final `agent_end` (`willRetry:true`, or followed by more runs before `agent_settled`)
      maps to `null`; no terminal is emitted until `agent_settled`. (verified by the retry-sequence
      test and the 3 settled-form terminal tests)
- [x] `agent_settled` emits exactly one terminal event with the correct kind, derived from the
      settled run's last assistant `stopReason`. (verified by the 3 rewritten terminal tests)
- [x] The three existing `stopReason` mapper tests still assert those dispositions, rewritten to the
      settled form, not deleted. (verified — same file, same names generalized to "on settle")
- [x] A retry sequence yields exactly one `turn_completed`. (verified by the new retry-sequence test)
- [x] `PiAgentSession.run()` resolves at `agent_settled`, not the interim `agent_end`. (verified by
      `describe("sprint-041 regression: …")`'s `PiAgentSession.run() must wait for agent_settled …`
      test, now passing against the fix using fake timers)
- [x] `npm run build:server` and `npm run typecheck` pass.

## Follow-ups / TODO(verify)
- None for this task. `FakeTransport` fixture update, the createSession/interrupt test fixes, and the
  agent-service-level regression test are task-002's scope, tracked there.
</content>
