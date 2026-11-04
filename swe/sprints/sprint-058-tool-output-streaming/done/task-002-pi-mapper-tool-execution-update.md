# Task 002 — Pi mapper: `tool_execution_update` → partial `tool_call`

- **Sprint:** sprint-058-tool-output-streaming
- **Status:** done
- **Type:** feature
- **Area:** packages/server (agent/providers/pi)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001
- **Spec re-baselined:** 2026-11-03 against Pi 1.4.0 and the current tree

## Goal

Stop dropping Pi's `tool_execution_update` events: map each one to a `tool_call` event with
`status: "running"`, `partial: true`, and `tool.output` set to the partial text Pi reports.

## Context / why

`tool_execution_update` is currently in the mapper's deliberate ignore list
(`event-mapper.ts` ≈ L290–302, `case "tool_execution_update": … return null` at L299), which is the
root cause of the dead-air problem: a `ToolCard` for a long-running tool shows only a spinner and
an `output · N lines` strip that never moves until `tool_execution_end` arrives.

**The one real trap.** `outputOf()` (`event-mapper.ts` ≈ L21–30) reads `asRecord(tool.result).content`
only; its doc comment says "Pi RPC `tool_execution_end` shape". Update events do **not** carry
`result` — they carry the partial text under `partialResult.content` (Pi 1.4.0:
`node_modules/@earendil-works/pi-coding-agent/docs/json.md` ≈ L104–115, and
`dist/core/extensions/types.d.ts` ≈ L862–869 — note Pi's `docs/rpc.md` no longer documents the
tool-execution events; it delegates to `json.md`). Left unchanged, `outputOf` returns `undefined`
for every update and the whole feature silently produces empty snapshots. This is the same class of
bug that once made tool cards render with empty details, so it gets its own acceptance criterion.

**Snapshot vs delta is tool-specific.** Pi's `json.md` says whether a `partialResult` replaces or
extends an earlier one "depends on that tool's result contract". The only tool verified to send
**accumulated snapshots** is `bash` (`dist/core/tools/bash.js` ≈ L181–190 calls `onUpdate` with the
full `OutputAccumulator` snapshot, already self-throttled at 100 ms and self-capped at ~50 KB /
2000 lines by `dist/core/tools/truncate.js`). The mapper **does not** try to reconcile either
contract — it emits whatever Pi sent as the snapshot and never concatenates. Replace-semantics
downstream (task 003 coalescer, client `mergeTool`) is correct for snapshot-style tools and is what
the sprint ships; a delta-style custom tool would render its latest chunk rather than the whole
output, which is a visible-but-harmless degradation and is documented, not fixed, in this sprint.

`bash` also sends an **initial** `onUpdate({ content: [], details: undefined })` (`bash.js` ≈ L215).
That maps to a partial with no `output` field (empty text join ⇒ `undefined`), which `mergeTool`
treats as "nothing to merge" — harmless, but the test fixtures should include it.

`args` **are** present on update events, so command/path/query detail maps exactly as it does for
`tool_execution_start` (`mapToolCall` reads `tool.input ?? tool.arguments ?? tool.args`); no
`mapToolCall` change for that.

**Three non-partial `tool_call` producers already exist**, not two: `tool_execution_start`
(`status: "running"`), `tool_execution_end` (`"completed"`/`"error"`), **and** `message_update` with
`toolcall_end` (≈ L186–192, `status: "started"`). A partial may therefore follow a `"started"` row;
the client normalizes `"started"` to `running`, so nothing special is needed, but the mapper's
header comment (≈ L102–103), `mapToolCall`'s doc comment (≈ L37–38, "output … only present on
*end* events") and `mapPiEvent`'s doc (≈ L313–314) all enumerate the tool events and must be
updated to name `tool_execution_update` too.

**Nested tool calls.** Pi emits `tool_execution_update` for sub-agent tool calls as well, with
`toolCallId` of the form `<parent>/<n>` and an optional `parentToolCallId` (`docs/extensions.md`
≈ L261). The mapper already passes nested ids through for start/end; updates follow the same path
and create/merge a row keyed by that nested id. Nothing new to build — but the test table should
include a nested id so the behavior is pinned.

## Scope references

- `swe/features/tool-output-streaming.md` § Public Contract → Pi event mapping, § Design tenet 3
- `packages/server/src/agent/providers/pi/event-mapper.ts` ≈ L21–30 — `outputOf`
- `packages/server/src/agent/providers/pi/event-mapper.ts` ≈ L40–89 — `mapToolCall`
- `packages/server/src/agent/providers/pi/event-mapper.ts` ≈ L186–192 — `message_update`/`toolcall_end`
- `packages/server/src/agent/providers/pi/event-mapper.ts` ≈ L208–222 — `tool_execution_start`/`_end`
- `packages/server/src/agent/providers/pi/event-mapper.ts` ≈ L290–302 — the ignore list to shrink
- `node_modules/@earendil-works/pi-coding-agent/docs/json.md` ≈ L104–115 — the payload shape
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` ≈ L862–869 —
  `ToolExecutionUpdateEvent` type
- `packages/server/src/agent/providers/pi/pi-adapter.test.ts` ≈ L306–372 — existing start/end
  mapper cases; ≈ L146–156 — fake-transport tool events; ≈ L349 — "leaves output undefined on
  tool_execution_start"
- Modify: `event-mapper.ts`, `pi-adapter.test.ts`

## What to build

**1. `outputOf` reads both shapes.** Prefer `result.content`, fall back to `partialResult.content`;
same text-block filter/join as today. Keep it one function — two near-identical readers would drift.
Update its doc comment.

**2. New mapper case**, placed with the other tool-execution cases:

```
case "tool_execution_update":
  return { kind: "tool_call", callId: str(event.toolCallId),
           tool: mapToolCall(event), status: "running", partial: true };
```

Remove `tool_execution_update` from the ignored list and update that block's comment so it stays an
accurate statement of what is deliberately dropped (after this task: `turn_start`, `turn_end`,
`message_start`, `message_end`, `auto_retry_start`, `auto_retry_end`).

**3. Comment sweep** inside `event-mapper.ts` only: the three places listed above that enumerate the
tool-execution events.

The mapper stays **pure and stateless for this event** — no throttling, no per-`callId` bookkeeping.
Rate control is task 003's job, deliberately separated so the mapper remains trivially table-testable.

`todoDetailsFromFrame` (`todos.ts` ≈ L147) handles only `tool_execution_end` and `entry_appended`,
so the sprint-079 todo path is unaffected by updates starting to flow; no change there.

## Out of scope

- Throttling/coalescing, tail-capping, history exclusion, cancellation (task 003).
- Persistence policy (task 004).
- Any change to the `agent_end`/`agent_settled` disposition latching (≈ L136–172).
- Reconciling delta-style `partialResult` contracts into snapshots.

## Acceptance criteria

- [ ] `tool_execution_update` maps to `{ kind: "tool_call", callId, status: "running",
      partial: true }` with `tool.output` = joined `partialResult` text blocks.
- [ ] A dedicated test asserts output is read from **`partialResult`** when `result` is absent, and
      still from `result` when present (both directions, so neither reader regresses).
- [ ] `tool_execution_start` (no `result`, no `partialResult`) still yields `output: undefined` and
      `status: "running"` **without** `partial` — start events are persisted rows, not snapshots.
- [ ] `message_update`/`toolcall_end` still yields `status: "started"` without `partial`.
- [ ] `tool_execution_end` still yields `status: "completed"`/`"error"` with no `partial` field, and
      `edit` still pulls its diff from `result.details.patch`.
- [ ] Command/path/query detail maps identically for an update event and a start event with the same
      `args`.
- [ ] Two successive updates for one `callId` each carry exactly the text Pi sent; the mapper
      never concatenates them.
- [ ] An update with `partialResult.content: []` (bash's initial update) and one with only non-text
      blocks each yield no `output` field rather than an empty string.
- [ ] A nested `toolCallId` (`<parent>/<n>`, with `parentToolCallId`) maps to a partial with that
      nested `callId`, same as start/end do today.

## Test / verification plan

- Build: `npm run build:server` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: extend `pi-adapter.test.ts` (table-driven, alongside the existing `mapPiEvent` cases); run
  `npx vitest run packages/server/src/agent/providers/pi`.

## Notes

- `mapPiEvent` (the stateless wrapper) is fine for these assertions — update events carry no
  turn-disposition state, which is exactly the case its doc comment says it is for.
- Root invariant 3: nothing outside `agent/` may import `pi/`. This task stays inside `pi/`.
- `docs/agent-stream-events.md` still lists `tool_execution_update` as ignored (and, stale since
  sprint-074, `compaction_start`/`compaction_end` too). Task 007 fixes the doc; do not touch it here.
