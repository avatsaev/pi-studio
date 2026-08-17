# Task 005 — web-client: live output tail, turn-terminal tool-row closing, terminal-output authority

- **Sprint:** sprint-058-tool-output-streaming
- **Status:** backlog
- **Type:** feature
- **Area:** packages/web-client
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal

Show streamed output as it arrives: while a tool call is `running` and has output, its card renders a
capped live tail without needing to be expanded. Close the two terminal-state holes the spec review
found: a canceled/failed turn must close still-`running` tool rows (else the tail pins forever), and
a terminal event's `output` is authoritative (else a stale partial masquerades as final output).

## Context / why

`applyStreamEvent` needs **no new case** for partials — that is the point of tenet 1. `onToolCall`
already upserts by `callId` and `mergeTool` already replaces `output` with the latest non-empty
value (`reducer.ts:116-160`), which is exactly right for accumulated snapshots while `running`.

But the spec review surfaced two terminal-state defects that the tail makes visible:

- **Stale `running` on abort.** `onTurnCanceled`/`onTurnFailed` call `finalizeStreamingRows`, which
  touches only streaming assistant/reasoning rows (`reducer.ts:162-176`) — a tool whose
  `tool_execution_end` never arrives (turn aborted mid-tool) keeps `status: "running"` forever.
  Today that is a stale badge; with the tail rule (*render while `running` and output non-empty*)
  it becomes a permanently rendered live-tail block.
- **Merge asymmetry at the terminal.** `mergeTool` keeps existing non-empty fields when the incoming
  event lacks them. If a terminal event carries no result text after partials streamed, the last
  partial's output stays rendered as final — but the persisted timeline (start + end rows only)
  has none, so a reload shows a different card. Live and hydrated views must converge.

`partial` is deliberately **not** stored on `ToolRow` — it describes the delivery of one snapshot
and has no meaning once merged.

## Scope references

- `swe/features/tool-output-streaming.md` § Behavior & Algorithms → Client reducer / `ToolCard` live
  tail, § Error Handling (turn-aborted and terminal-empty-output rows)
- `swe/features/timeline-rendering.md` § tool-call cards
- `packages/web-client/src/timeline/reducer.ts:116-176` — `mergeTool`, `onToolCall`,
  `onTurnCanceled`/`onTurnFailed`
- `packages/web-client/src/hooks/agent-stream-events.ts:44-51` — the completion-only invalidation
- `packages/web-client/src/timeline/row-model.ts:70-78` — `ToolRow` (status gains `"canceled"`)
- `packages/web-client/src/features/chat/rows/ToolCard.tsx` — the card + `BADGE_VARIANT` map
- `packages/web-client/src/features/chat/Timeline.tsx:32-61` — virtualizer + `measureElement`
- `packages/web-client/src/timeline/tool-mapping.ts` — `toolBody` (expanded sections)
- Modify: `reducer.ts`, `row-model.ts`, `ToolCard.tsx`, `rows.module.css`,
  `timeline/reducer.test.ts`; add a small pure tail helper + its test

## What to build

**1. A pure tail helper** (own `.ts` module, own `.test.ts`): given output text and a line cap, return
the last `LIVE_TAIL_LINES = 12` lines. Pure so it is testable under the repo's node-environment Vitest
setup — no jsdom, per project convention.

**2. `ToolCard` live tail.** When `row.status === "running"` **and** `tool.output` is non-empty,
render the tail below the header in the existing monospace `toolCode` style, newest line at the
bottom, even when the card is collapsed. On a terminal status the tail disappears and the card
behaves exactly as today (header-only unless the user expanded it; expanded body shows full output
via `toolBody`). A user's manual expand/collapse must survive the running → terminal transition.

**3. Bounded height.** The tail block gets a max height with its own scroll/clip so a chatty tool can
never grow the row without bound; the virtualizer's `measureElement` re-measure cost stays constant.

**4. Turn-terminal closes open tool rows.** `onTurnCanceled` marks every tool row still `"running"`
as `"canceled"`; `onTurnFailed` marks them `"error"`. `"canceled"` is a new client-local `ToolRow`
status: extend the type in `row-model.ts` and add a muted `BADGE_VARIANT` entry in `ToolCard.tsx`.
This also fixes the pre-existing stale-badge defect. `onTurnCompleted` is untouched — a normally
completed turn had every end event delivered.

**5. Terminal output is authoritative.** In `onToolCall`, when the incoming status is
`"completed"`/`"error"`, set the merged row's `output` from the incoming event verbatim — including
clearing it when absent/empty — while other fields (command/path/diff) keep `mergeTool`'s
keep-non-empty semantics. While `running`, merge behavior is unchanged.

## Out of scope

- Any server-side work (tasks 002–004) and the CLI guard (task 006).
- Storing `partial` on the row model, or a new `TimelineRow` kind.
- Persisting/restoring tails across reload (partials are ephemeral by design).
- Closing tool rows on `turn_completed` — no evidence of a leak on the normal path.
- New component-test infrastructure (jsdom) — not part of this project's conventions.

## Acceptance criteria

- [ ] Applying a partial `tool_call` through `applyStreamEvent` merges its `output` into the existing
      row keyed by `callId`; three snapshots `"a"`, `"ab"`, `"abc"` leave output `"abc"`, never
      accumulated concatenation.
- [ ] A partial arriving for an unknown `callId` creates a row (no start-event ordering assumption).
- [ ] Merging a partial never clears the command/path/query detail captured from the start event.
- [ ] `partial` is not present on `ToolRow`.
- [ ] A partial event does **not** trigger `invalidateAfterToolCompletion`, and does not change
      session status or title.
- [ ] `turn_canceled` flips a still-`running` tool row to `"canceled"`; `turn_failed` flips it to
      `"error"`; already-terminal rows are untouched; `turn_completed` changes no tool row.
- [ ] A terminal `tool_call` with absent/empty output **clears** previously merged partial output
      (live view equals a replay of start + end events alone); a terminal with output replaces it;
      command/path/diff survive the terminal merge as today.
- [ ] The tail helper returns the last 12 lines for longer output, the whole text for shorter,
      handles a trailing newline without a blank last line, and is deterministic.
- [ ] Manual browser check: growing tail while collapsed and running; tail gone on completion **and**
      on cancel (badge shows `canceled`); manual expand survives the transition; timeline stays
      bottom-stuck while streaming.

## Test / verification plan

- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: extend `packages/web-client/src/timeline/reducer.test.ts` (incl. the two terminal-state
  cases); add the tail-helper test; run `npx vitest run packages/web-client/src/timeline`.
- Manual: dev daemon (`npm run dev:daemon`, mock partials after task 004) + web client; exercise a
  streamed tool call, a mid-tool interrupt, and a completed turn.

## Notes

- Font sizes/spacing in new CSS must use the design-token rem ladder — raw pixel font-size literals
  fail `theme/font-scale.test.ts`.
- The `"canceled"` status is client-local only — the wire `status` string is unchanged; do not add
  it to any protocol schema.
- The output-authority rule intentionally makes an old client and a new client render *different*
  finals in the empty-output edge (old keeps the last partial). That is acceptable drift on a
  cosmetic path; do not try to fix old clients.
