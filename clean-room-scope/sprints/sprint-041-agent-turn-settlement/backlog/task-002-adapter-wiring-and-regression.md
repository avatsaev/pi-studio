# Task 002 — Fake-transport settle wiring + retry-subscription regression test

- **Sprint:** sprint-041-agent-turn-settlement
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Make the Pi adapter's test double emit `agent_settled` like real Pi, and add the regression test that
proves the reported bug is closed: a retried/continued turn keeps its daemon subscription and reports
terminal status only once, at settle.

## Background / why
`FakeTransport` in `pi-adapter.test.ts` currently ends a scripted turn on `agent_end` and shortcuts
`abort` to a bare `agent_end`. After task-001, `agent_end` is non-terminal, so the fake must emit
`agent_settled` (as real Pi always does via `_emitAgentSettled`) or `run()` would never resolve.

The actual reported failure lives at the `agent-service.ts` `runTurn` boundary: an interim terminal
tears down the stream subscription (`unsubscribe()`), flips status to `idle`, and can `archiveAgent()`
under `autoArchive` — mid-turn. task-001 fixes *when* the terminal fires; this task adds the
end-to-end regression proving the daemon now stays subscribed across a retry/continuation and settles
exactly once.

## Scope references
- `packages/server/src/agent/providers/pi/pi-adapter.test.ts` (`FakeTransport.notify` `:93-120` —
  the `prompt` arm's closing `agent_end` at `:115`, the `abort` arm's bare `agent_end` at `:117`;
  the createSession stream test's expected-kinds array `:330-339`; the interrupt test `:400-407`)
- `packages/server/src/agent/agent-service.ts` (`runTurn` `:243-353` — subscription lifetime, status
  flip, `autoArchive` hook; `unsubscribe()` `:328`, `newStatus` `:333-334`, terminal-gated
  `archiveAgent` `:343-352`)
- `packages/server/src/agent/providers/mock/mock-provider.ts` (already emits a single terminal per
  turn — reference the scripted-turn shape for a fake session that emits an interim non-terminal
  `agent_end` then more rows then `agent_settled`)
- `packages/server/src/agent/create-run.test.ts` (existing runTurn/stream coverage — add the
  regression here or a sibling `*.test.ts`)

## What to build
1. `FakeTransport` updates:
   - `prompt` arm: append `{ type: "agent_settled" }` after the existing `agent_end`.
   - `abort` arm: emit `agent_end` with `messages:[{ role:"assistant", stopReason:"aborted" }]`
     then `agent_settled` (so interrupt flows through as `turn_canceled`).
2. Fix the two existing adapter tests for the new terminal timing:
   - createSession stream: expected kinds stay `[turn_started, assistant_message, tool_call,
     tool_call, turn_completed]` — the fake now closes with `agent_settled`; verifies the happy path
     is unchanged end-to-end.
   - interrupt: tighten to assert `turn_canceled` (was "contains turn_completed").
3. Add the **regression test** at the `agent-service` level: drive a fake/mock session that emits
   `turn_started` → an interim non-terminal run's rows → (still no terminal) → more rows → a single
   terminal, and assert:
   - status is NOT broadcast `idle` until the terminal arrives (no premature flip),
   - every row (including the post-interim rows) is appended to the timeline and broadcast,
   - `autoArchive` archives exactly once, at the terminal — not on the interim run.

## Out of scope
- The mapper logic itself (task-001). Docs sync + full-suite verification (task-003).
- Any new protocol event kinds or `auto_retry_*`/`compaction_*` surfacing.

## Acceptance criteria
- [ ] `FakeTransport` emits `agent_settled` after `agent_end` on both `prompt` and `abort`; the
      abort arm carries an `"aborted"` stopReason.
- [ ] createSession stream test passes with terminal timing driven by `agent_settled`; interrupt test
      asserts `turn_canceled`.
- [ ] A retry/continuation regression test proves: no premature `idle`, no lost post-interim rows,
      single `autoArchive`.
- [ ] `npx vitest run packages/server/src/agent` passes.

## Test / verification plan
- `npx vitest run packages/server/src/agent/providers/pi/pi-adapter.test.ts`
  `packages/server/src/agent/create-run.test.ts` (or the sibling holding the new regression).
- Then the scoped agent suite: `npx vitest run packages/server/src/agent`.

## Notes
- Keep fake event scripts deterministic (no timers/random) so assertions don't flake.
- The regression test is the load-bearing proof for the whole sprint — favour a mock/fake session
  that directly emits the mapped `AgentStreamEvent`s over spinning a real transport, so it targets
  `runTurn`'s subscription/lifetime logic precisely.
