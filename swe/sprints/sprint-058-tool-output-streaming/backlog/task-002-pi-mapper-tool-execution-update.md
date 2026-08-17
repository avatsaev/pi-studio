# Task 002 — Pi mapper: `tool_execution_update` → partial `tool_call`

- **Sprint:** sprint-058-tool-output-streaming
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (agent/providers/pi)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal

Stop dropping Pi's `tool_execution_update` events: map each one to a `tool_call` event with
`status: "running"`, `partial: true`, and `tool.output` set to the accumulated partial text.

## Context / why

`tool_execution_update` is currently in the mapper's deliberate ignore list
(`event-mapper.ts:230-240`), which is the root cause of the dead-air problem: a `ToolCard` for a
long-running tool shows a bare `running` badge until `tool_execution_end` arrives.

**The one real trap.** `outputOf()` (`event-mapper.ts:17-26`) reads `asRecord(tool.result).content`.
Update events do **not** carry `result` — they carry the accumulated text under
`partialResult.content` (Pi `docs/rpc.md` § tool_execution_start/update/end). Left unchanged,
`outputOf` returns `undefined` for every update and the whole feature silently produces empty
snapshots. This is the same class of bug that once made tool cards render with empty details, so it
gets its own acceptance criterion rather than a comment.

Pi's `partialResult` is the **accumulated output so far, not a delta** — the client replaces its
display on each update. That is what makes the coalescing in task 003 lossless, so preserve
replace-semantics here: never concatenate.

`args` **are** present on update events, so command/path/query detail maps exactly as it does for
`tool_execution_start`; `mapToolCall` needs no change for that.

## Scope references

- `swe/features/tool-output-streaming.md` § Public Contract → Pi event mapping, § Design tenet 3
- `packages/server/src/agent/providers/pi/event-mapper.ts:17-26` — `outputOf`
- `packages/server/src/agent/providers/pi/event-mapper.ts:36-85` — `mapToolCall`
- `packages/server/src/agent/providers/pi/event-mapper.ts:198-211` — `tool_execution_start`/`_end`
- `packages/server/src/agent/providers/pi/event-mapper.ts:230-240` — the ignore list to shrink
- `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md` § tool_execution_* — the payload shape
- Modify: `event-mapper.ts`, `packages/server/src/agent/providers/pi/pi-adapter.test.ts`

## What to build

**1. `outputOf` reads both shapes.** Prefer `result.content`, fall back to `partialResult.content`;
same text-block filter/join as today. Keep it one function — two near-identical readers would drift.

**2. New mapper case**, placed with the other tool-execution cases:

```
case "tool_execution_update":
  return { kind: "tool_call", callId: str(event.toolCallId),
           tool: mapToolCall(event), status: "running", partial: true };
```

Remove `tool_execution_update` from the ignored list and update that block's comment so it stays an
accurate statement of what is deliberately dropped.

The mapper stays **pure and stateless for this event** — no throttling, no per-`callId` bookkeeping.
Rate control is task 003's job, deliberately separated so the mapper remains trivially table-testable.

## Out of scope

- Throttling/coalescing, tail-capping, history exclusion, cancellation (task 003).
- Persistence policy (task 004).
- Any change to the `agent_end`/`agent_settled` disposition latching.

## Acceptance criteria

- [ ] `tool_execution_update` maps to `{ kind: "tool_call", callId, status: "running",
      partial: true }` with `tool.output` = joined `partialResult` text blocks.
- [ ] A dedicated test asserts output is read from **`partialResult`** when `result` is absent, and
      still from `result` when present (both directions, so neither reader regresses).
- [ ] `tool_execution_start` (no `result`, no `partialResult`) still yields `output: undefined` and
      `status: "running"` **without** `partial` — start events are persisted rows, not snapshots.
- [ ] `tool_execution_end` still yields `status: "completed"`/`"error"` with no `partial` field, and
      `edit` still pulls its diff from `result.details.patch`.
- [ ] Command/path/query detail maps identically for an update event and a start event with the same
      `args`.
- [ ] Two successive updates for one `callId` each carry the full accumulated snapshot; the mapper
      never concatenates them.
- [ ] Non-text `partialResult.content` blocks yield no `output` field rather than an empty string.

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
