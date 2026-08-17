# Task 003 — Per-`callId` coalescer: throttle, tail-cap, cancel-before-terminal, history exclusion

- **Sprint:** sprint-058-tool-output-streaming
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (agent/providers/pi)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002

## Goal

Bound the rate and size of partial snapshots leaving `PiAgentSession`, guarantee no partial is
delivered after its tool call's terminal event, and keep partials out of the session's replay
history.

## Context / why

A tool that prints in a tight loop can emit `tool_execution_update` far faster than any UI can
render or any relay frame should carry. Because each snapshot is **accumulated** (task 002), dropping
intermediates is lossless — so coalescing is pure win, not a tradeoff.

**The ordering hazard is the reason this is its own task.** `onToolCall` in the web client derives the
row's status from the **latest** event it received (`reducer.ts:125-160`). If a trailing-edge timer
fires after `tool_execution_end`, the card regresses `completed` → `running` and stays wrong for the
rest of the session. A naive throttle wrapper has exactly this bug. Cancellation on the terminal
event is therefore an acceptance criterion with its own race test, not an implementation detail.

**Why here and not in `agent-service`:** chattiness is a Pi trait, and this is where per-`callId`
state and the history buffer both live. `PiAgentSession.emit` (`agent.ts:148-151`) pushes every event
into `this.history` (`agent.ts:113`), which `streamHistory()` replays (`agent.ts:198-200`) — a partial
in there would be replayed as history, contradicting the ephemeral contract. Excluding it at the
emit seam handles both concerns in one place.

## Scope references

- `swe/features/tool-output-streaming.md` § Behavior & Algorithms → Server coalescer,
  § Coalescing parameters, § Design tenets 3–4, § Error Handling
- `packages/server/src/agent/providers/pi/agent.ts:113` — the `history` buffer
- `packages/server/src/agent/providers/pi/agent.ts:148-151` — `emit()`, the seam to wrap
- `packages/server/src/agent/providers/pi/agent.ts:198-200` — `streamHistory()`
- `packages/server/src/agent/providers/pi/event-mapper.ts:151-162` — `agent_settled` terminal
- Create: `packages/server/src/agent/providers/pi/tool-output-coalescer.ts` (+ test)
- Modify: `packages/server/src/agent/providers/pi/agent.ts`

## What to build

**A standalone coalescer module** with injected `now()` and timer functions (the project's existing
test-seam style), so every timing assertion is deterministic — no real waiting in tests.

Constants (spec § Coalescing parameters):

| Constant | Value |
|---|---|
| `PARTIAL_MIN_INTERVAL_MS` | 200 |
| `PARTIAL_OUTPUT_CAP_BYTES` | 65536 |

Behavior per `callId`:

- **Leading edge:** first partial for a call, or one arriving ≥ `PARTIAL_MIN_INTERVAL_MS` after the
  last emit, is emitted immediately.
- **Trailing edge:** an earlier-than-interval partial is stored as `pending[callId]` (latest wins,
  overwriting any prior pending) and a single flush is scheduled at
  `lastEmit + PARTIAL_MIN_INTERVAL_MS`. Never queue more than one timer per call.
- **Tail cap:** emitted `tool.output` is truncated to the **last** `PARTIAL_OUTPUT_CAP_BYTES` (tail,
  not head — the interesting part of a build log is the end). The terminal event's output is never
  capped by this path.
- **Terminal cancels:** a non-partial `tool_call` for a `callId` cancels that call's pending flush and
  discards `pending[callId]` **before** emitting.
- **Turn terminal cancels everything:** `turn_completed`/`turn_failed`/`turn_canceled` and session
  close/dispose cancel all pending flushes, so nothing escapes after a turn ends or an abort.
- **History exclusion:** partials are delivered to subscribers but never pushed to `this.history`.

Wire it into `emit()` so non-partial events keep their exact current path (history push + fan-out).

## Out of scope

- The persistence branch in `agent-service` and mock-provider partials (task 004).
- Client rendering (task 005).
- Any change to disposition latching or terminal-event semantics.

## Acceptance criteria

- [ ] Given 10 partials for one `callId` within 200 ms, exactly 2 are emitted (leading + one trailing
      flush) and the trailing one carries the **latest** snapshot, not an earlier one.
- [ ] Partials spaced ≥ 200 ms apart are all emitted immediately, with no trailing duplicates.
- [ ] **Race test:** a partial arrives, then `tool_execution_end` for the same `callId` arrives before
      the trailing flush is due ⇒ the terminal event is emitted and **no** partial is emitted
      afterwards; advancing the clock past the flush deadline emits nothing.
- [ ] Two interleaved `callId`s are throttled independently (one's traffic never suppresses the
      other's leading edge).
- [ ] A turn terminal (`turn_completed`/`_failed`/`_canceled`) and session close each cancel all
      pending flushes; advancing the clock afterwards emits nothing.
- [ ] An emitted snapshot larger than 64 KiB is truncated to its **last** 64 KiB; a
      `tool_execution_end` output larger than that is emitted untruncated.
- [ ] After a turn containing streamed partials, `streamHistory()` yields **no** event with
      `partial: true`, and still yields the tool call's start and end events.
- [ ] Non-partial event ordering and content are byte-identical to today (regression-locked by the
      existing pi-adapter tests passing untouched).

## Test / verification plan

- Build: `npm run build:server` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: new `tool-output-coalescer.test.ts` (fake clock/timers, no real delays) + a
  `pi-adapter.test.ts` case driving partials through the fake transport to prove the `emit`/history
  wiring; run `npx vitest run packages/server/src/agent/providers/pi`.

## Notes

- Prefer the module + injected seams over an inline closure in `agent.ts`: the race above is the kind
  of thing that needs its own focused test file, and `agent.ts` is already large.
- Byte-length for the cap should be measured consistently (decide `Buffer.byteLength` vs string
  length and state it in the module comment) — a multi-byte tail must not be split into an invalid
  sequence; slice on a character boundary.
- Do not attempt to also cap the *stored* end-event output; that path is unchanged today and
  narrowing it would be a silent behavior change outside this sprint.
