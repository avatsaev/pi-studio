# Task 002 — Fake-transport settle wiring + retry-subscription regression test — Summary

- **Sprint:** sprint-041-agent-turn-settlement
- **Completed:** 2026-08-03
- **Status:** done

## What was implemented
1. `FakeTransport.notify` (`pi-adapter.test.ts`) now emits `agent_settled` after `agent_end` on
   both scripted arms:
   - `prompt` arm: `agent_end` → `agent_settled` (was a bare `agent_end`).
   - `abort` arm: `agent_end` now carries `messages:[{role:"assistant", stopReason:"aborted"}]` →
     `agent_settled` (was a bare `agent_end` with no `messages`, which under the old unconditional
     mapper still produced `turn_completed`, not `turn_canceled` — this was itself a latent
     fixture bug the interrupt test's loose `toContain` assertion was masking).
2. Fixed the two dependent adapter tests for the new terminal timing:
   - `createSession spawns the process and streams a mapped turn` needed **no line change** — its
     expected-kinds array (`[turn_started, assistant_message, tool_call, tool_call,
     turn_completed]`) was already correct for the settled form; it now passes end-to-end against
     the real `agent_settled`-driven terminal instead of the old per-`agent_end` one.
   - `interrupt aborts the active turn` tightened from `expect(...).toContain("turn_completed")` to
     `expect(...).toEqual(["turn_canceled"])` — the fixture bug above meant this test was
     previously passing for the wrong reason (asserting the wrong terminal kind existed among a
     loosely-checked list).
   - The `slash-prompt turn completion` suite's `SlashTransport` extends `FakeTransport` but drives
     its terminal manually via `fireEvent`; its "a real turn (isStreaming: true)" test now fires
     `{type:"agent_end"}` **then** `{type:"agent_settled"}` (was a bare `agent_end`).
3. Added the load-bearing regression at the `agent-service` level: a new sibling test file,
   `packages/server/src/agent/turn-settlement.test.ts`, with a hand-written `RetryAgentSession`
   (`AgentSession` implementation) whose `run()` streams an interim run's rows and stays
   deliberately pending — no timers, test-driven via a `continueAfterRetry()` control method — until
   the test explicitly advances it, mirroring the real async gap between a retried Pi run and its
   settlement. Drives `AgentService.runTurn(..., {autoArchive: true})` directly and asserts, in
   order:
   - before `continueAfterRetry()`: no `idle` status broadcast, `archiveAgent` not called, agent
     status still `"running"` — the interim run alone must not finalize anything;
   - after settlement: every row (both the interim AND the post-interim "attempt 2" rows) is on the
     timeline in order, `idle` is broadcast exactly once (as the LAST status), and
     `manager.archiveAgent` is called exactly once, with the correct agent id.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/providers/pi/pi-adapter.test.ts` | modified — `FakeTransport.notify` emits `agent_settled` on both `prompt`/`abort`; `interrupt` test tightened; slash-prompt real-turn test fires `agent_settled` |
| `packages/server/src/agent/turn-settlement.test.ts` | created — `RetryAgentSession` fixture + the `runTurn` retry/settlement regression test (task-002's sign-off proof) |

## How it satisfies the scope
Matches `task-002-adapter-wiring-and-regression.md` § What to build items 1–3: fixture settle
wiring (item 1), the two dependent test fixes (item 2), and the `agent-service`-level regression
proving no premature `idle`, no lost post-interim rows, and single `autoArchive` (item 3) — built as
a fake/mock `AgentSession` per the task's own Notes guidance ("favour a mock/fake session that
directly emits the mapped `AgentStreamEvent`s over spinning a real transport, so it targets
`runTurn`'s subscription/lifetime logic precisely"), in a sibling `*.test.ts` file as suggested.

## Build & test results
```
$ npx vitest run packages/server/src/agent/providers/pi/pi-adapter.test.ts
✓ 49 passed (49)

$ npx vitest run packages/server/src/agent/turn-settlement.test.ts
✓ 1 passed (1)

$ npx vitest run packages/server/src/agent
✓ 19 test files, 196 tests passed

$ npm run build:server
tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js   → success, no errors

$ npx oxlint packages/server/src/agent/turn-settlement.test.ts packages/server/src/agent/providers/pi/pi-adapter.test.ts
(no output — clean)
```
Typecheck note: as with task-001, `*.test.ts` is excluded from `packages/server/tsconfig.json`'s
build graph, so `npm run typecheck` doesn't cover test files. Verified `turn-settlement.test.ts` and
`pi-adapter.test.ts` compile clean by temporarily lifting the test exclusion and running
`tsc -b --force` (0 errors attributable to either file; unrelated pre-existing errors in other test
files were left untouched), then restored the tsconfig unchanged.

## Acceptance criteria
- [x] `FakeTransport` emits `agent_settled` after `agent_end` on both `prompt` and `abort`; the
      abort arm carries an `"aborted"` stopReason.
- [x] createSession stream test passes with terminal timing driven by `agent_settled`; interrupt
      test asserts `turn_canceled`.
- [x] A retry/continuation regression test proves: no premature `idle`, no lost post-interim rows,
      single `autoArchive`.
- [x] `npx vitest run packages/server/src/agent` passes (19 files, 196 tests).

## Follow-ups / TODO(verify)
- None for this task. Scope-doc/AGENTS.md sync and the full workspace build+typecheck+test gate are
  task-003's scope, tracked there.
</content>
