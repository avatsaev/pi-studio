# Task 003 — Per-`callId` coalescer — Summary

- **Sprint:** sprints/sprint-058-tool-output-streaming
- **Completed:** 2026-11-03
- **Status:** done

## What was implemented
`tool-output-coalescer.ts` (`createToolOutputCoalescer`, injected clock/timers) bounds partial
snapshots per `callId`: 200 ms leading+trailing latest-wins throttle, 64 KiB **tail** cap on a
character boundary, a call's non-partial `tool_call` cancels that call's pending flush before it is
delivered, and a turn terminal or `close()` cancels everything. `PiAgentSession.emit` routes events
through `partialOutput.accept(event)`; accepted partials are delivered to subscribers by the coalescer
and **never pushed to `history`**, so `streamHistory()` (and post-restart hydration) contains none.
All other events keep the exact previous record-then-fan-out path.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/providers/pi/tool-output-coalescer.ts` | created |
| `packages/server/src/agent/providers/pi/tool-output-coalescer.test.ts` | created — 14 fake-clock tests |
| `packages/server/src/agent/providers/pi/agent.ts` | modified — `emit()` seam, `fanOut()`, `close()` → `cancelAll()` |
| `packages/server/src/agent/providers/pi/pi-adapter.test.ts` | added a fake-transport test proving history exclusion |

## How it satisfies the scope
Matches § Server coalescer / § Coalescing parameters (`PARTIAL_MIN_INTERVAL_MS` 200,
`PARTIAL_OUTPUT_CAP_BYTES` 65536). The terminal-outruns-trailing race (which would regress `status`
and `statusText` on the client) has its own test. No deviation.

## Build & test results
```
$ npm run clean && npm run build        → success
$ npm run typecheck                     → success
$ npx oxlint <changed files>            → clean (after fixing toSorted + helper-hoisting warnings)
$ npx oxfmt --check <changed files>     → all formatted
$ npx vitest run packages/server/src/agent/providers/pi
Test Files 7 passed (7)   Tests 148 passed (148)
```

## Acceptance criteria
- [x] 10 partials in 200 ms → exactly 2 emitted; trailing carries the latest snapshot
- [x] Partials ≥ 200 ms apart all emit immediately, no trailing duplicates
- [x] Race: partial, then terminal before flush due → nothing emitted after the terminal
- [x] Interleaved `callId`s (incl. parent + nested `p/1`) throttled independently
- [x] Each turn terminal and `cancelAll()` (session close) cancel pending flushes
- [x] Snapshot > 64 KiB truncated to last 64 KiB on a char boundary (3- and 4-byte chars); terminal output uncapped
- [x] `streamHistory()` has no `partial: true` event, still has start and end
- [x] Non-partial ordering/content unchanged (existing pi-adapter tests pass untouched)

## Follow-ups / TODO(verify)
- Whether the 64 KiB cap ever triggers against real Pi output (`[INFERENCE]`: not for bash, which self-caps near 50 KB) — see task-007's live run.
