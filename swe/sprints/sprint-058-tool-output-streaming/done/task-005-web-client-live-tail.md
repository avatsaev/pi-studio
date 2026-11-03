# Task 005 — web-client: live output tail, turn-terminal tool-row closing, terminal-output authority

- **Sprint:** sprint-058-tool-output-streaming
- **Status:** done
- **Type:** feature
- **Area:** packages/web-client
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001 (task-004's `#tool` mock scenario for the manual check)
- **Spec re-baselined:** 2026-11-03 — sprint-059 (chat timeline redesign) and sprint-074
  (compaction rows) have landed; `ToolCard.tsx`, `reducer.ts` and `row-model.ts` differ materially
  from the original draft. Everything below describes the current files.

## Goal

Show streamed output as it arrives: while a tool call is `running` and has output, its card renders
a capped live tail without needing to be expanded. Close the two terminal-state holes the spec
review found: a canceled/failed turn must close still-`running` tool rows (else the tail pins
forever), and a terminal event's `output` is authoritative (else a stale partial masquerades as
final output).

## Context / why

`applyStreamEvent` needs **no new case** for partials — that is the point of tenet 1. `onToolCall`
(`reducer.ts` ≈ L149–202) already upserts by `callId` (via `toolCallKey`), normalizes any status
other than `completed`/`error` to `running`, and `mergeTool` (≈ L140–147) replaces `output` with
the latest non-empty value — exactly right for accumulated snapshots while `running`. Since
sprint-059 the upsert also writes `statusText` from the wire's raw status (≈ L167–173); a partial
carries `status: "running"`, so `statusText` stays `"running"` while streaming — fine.

What the current card already does with no change: `ToolCard.tsx` renders an
`output · N lines` strip (≈ L186–188, from `toolOutputLineCount`) whenever `tool.output` is
non-empty, so the line count will tick up live the moment partials flow. The strip is a count, not
content — the tail is what shows the user *what* is being printed.

The spec review surfaced two terminal-state defects that the tail makes visible:

- **Stale `running` on abort.** `onTurnCanceled` (≈ L267) and `onTurnFailed` (≈ L252) both route
  through `onTurnCompleted`, which is `cancelStartedCompactions(finalizeStreamingRows(state))`
  (≈ L218). `finalizeStreamingRows` touches only streaming assistant/reasoning rows;
  `cancelStartedCompactions` (≈ L209, sprint-074) closes `started` compaction rows. **Nothing closes
  a tool row** whose `tool_execution_end` never arrives (turn aborted mid-tool) — it keeps
  `status: "running"` and its spinner forever. Today that is a stale spinner; with the tail rule
  (*render while `running` and output non-empty*) it becomes a permanently rendered live-tail block.
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
- `packages/web-client/src/timeline/reducer.ts` ≈ L140–147 `mergeTool`; ≈ L149–202 `onToolCall`;
  ≈ L209–216 `cancelStartedCompactions` (the shape to mirror); ≈ L218 `onTurnCompleted`;
  ≈ L252–271 `onTurnFailed`/`onTurnCanceled`
- `packages/web-client/src/timeline/row-model.ts` ≈ L9 — `ToolCallStatus = "running" | "completed"
  | "error"`; ≈ L82–96 — `ToolRow` (already has `statusText?`)
- `packages/web-client/src/hooks/agent-stream-events.ts` ≈ L56–63 — the `tool_call` case:
  `invalidateAfterToolCompletion` fires only on `status === "completed" && toolMutatesFiles(tool)`
- `packages/web-client/src/features/chat/rows/ToolCard.tsx` — `statusTrailing(row)` (≈ L65–84, an
  if-chain over `completed`/`error`/`running`+`statusText`); the card body with the
  `toolCardBodyRunning/Completed/Error` class switch (≈ L129–135); the output strip (≈ L186);
  the collapsed `edit` diff preview (≈ L189–203); the expanded `toolBody` (≈ L204–216)
- `packages/web-client/src/features/chat/rows/rows.module.css` ≈ L134–144 (status border
  modifiers), ≈ L266–272 (`.toolBody` `max-height: 420px; overflow: auto`, `.toolCode`)
- `packages/web-client/src/timeline/tool-mapping.ts` ≈ L68–77 `toolBody`; ≈ L146–150
  `toolOutputLineCount`
- `packages/web-client/src/features/chat/Timeline.tsx` ≈ L245–267, L318 — virtualizer +
  `measureElement`; `use-bottom-anchor.ts` ≈ L66–69 — bottom-stick (`scrollToEnd` on `stick`)
- Modify: `reducer.ts`, `row-model.ts`, `ToolCard.tsx`, `rows.module.css`,
  `timeline/reducer.test.ts`; add a small pure tail helper + its test

## What to build

**1. A pure tail helper** (own `.ts` module in `timeline/`, own `.test.ts`): given output text and a
line cap, return the last `LIVE_TAIL_LINES = 12` lines. Pure so it is testable under the repo's
node-environment Vitest setup — no jsdom, per project convention.

**2. `ToolCard` live tail.** When `row.status === "running"` **and** `tool.output` is non-empty,
render the tail as a **distinct block** between the header and the output strip, in the existing
monospace `toolCode` style, newest line at the bottom, even when the card is collapsed. On a
terminal status the tail disappears and the card behaves exactly as today (header + strip, expanded
body via `toolBody` if the user opened it). Expansion is local `useState` keyed by the row's stable
`id`, so a manual expand/collapse survives the running → terminal transition automatically — the
acceptance check is that nothing in this task breaks that (no remount, no key change).

**3. Bounded height.** The tail block gets its own max-height class (do not reuse `.toolBody`'s
420 px — 12 lines of monospace is far less) with `overflow: hidden`/clip so a chatty tool can never
grow the row without bound; the virtualizer's `measureElement` re-measure cost stays constant and
`use-bottom-anchor` keeps the timeline stuck while the row grows.

**4. Turn-terminal closes open tool rows.** Add a `closeRunningTools(state, status)` helper shaped
like `cancelStartedCompactions` (early-return when no row is `running`). `onTurnCanceled` calls it
with `"canceled"`; `onTurnFailed` with `"error"`. **Do not** put it inside `onTurnCompleted` — a
normally completed turn had every end event delivered, and canceled/failed route through
`onTurnCompleted`, so the hook must sit in those two functions after that call. `"canceled"` is a
new client-local `ToolCallStatus` member: extend the union in `row-model.ts`, add a branch to
`statusTrailing` (muted text, no spinner), and a `toolCardBodyCanceled` border modifier matching the
existing three. Set `statusText` to the same value so the trailing text is stable.

**5. Terminal output is authoritative.** In `onToolCall`, when the incoming status is
`"completed"`/`"error"`, set the merged row's `tool.output` from the incoming event verbatim —
including clearing it when absent/empty — while other fields (command/path/diff) keep `mergeTool`'s
keep-non-empty semantics. While `running`/`started`, merge behavior is unchanged.

## Out of scope

- Any server-side work (tasks 002–004) and the CLI guard (task 006).
- Storing `partial` on the row model, or a new `TimelineRow` kind.
- Persisting/restoring tails across reload (partials are ephemeral by design).
- Closing tool rows on `turn_completed` — no evidence of a leak on the normal path.
- Any change to the `output · N lines` strip, the `edit` diff preview, or `toolBody`.
- New component-test infrastructure (jsdom) — not part of this project's conventions.

## Acceptance criteria

- [ ] Applying a partial `tool_call` through `applyStreamEvent` merges its `output` into the existing
      row keyed by `callId`; three snapshots `"a"`, `"ab"`, `"abc"` leave output `"abc"`, never
      accumulated concatenation; `status` stays `running` and `statusText` stays `"running"`.
- [ ] A partial arriving for an unknown `callId` creates a row (no start-event ordering assumption).
- [ ] Merging a partial never clears the command/path/query detail captured from the start event.
- [ ] `partial` is not present on `ToolRow`.
- [ ] A partial event does **not** trigger `invalidateAfterToolCompletion`, and does not change
      session status or title.
- [ ] `turn_canceled` flips a still-`running` tool row to `"canceled"`; `turn_failed` flips it to
      `"error"`; already-terminal rows are untouched; `turn_completed` changes no tool row;
      `started`-compaction cancellation (sprint-074 tests) still passes untouched.
- [ ] A terminal `tool_call` with absent/empty output **clears** previously merged partial output
      (live view equals a replay of start + end events alone); a terminal with output replaces it;
      command/path/diff survive the terminal merge as today.
- [ ] The tail helper returns the last 12 lines for longer output, the whole text for shorter,
      handles a trailing newline without a blank last line, and is deterministic.
- [ ] `theme/font-scale.test.ts` and the design-token tests pass (no raw px font sizes, token
      references only) for the new CSS.
- [ ] Manual browser check against `npm run dev:daemon` + `#tool` (task 004): growing tail while
      collapsed and running; tail gone on completion **and** on cancel (trailing text shows
      `canceled`, no spinner); manual expand survives the transition; `output · N lines` strip
      still present after completion; timeline stays bottom-stuck while streaming.

## Test / verification plan

- Build: `npm run build:web-client` succeeds.
- Typecheck: `npm run typecheck` succeeds.
- Lint/format: `npx oxlint <changed files>`, `npx oxfmt --check <changed files>` clean.
- Tests: extend `packages/web-client/src/timeline/reducer.test.ts` (incl. the two terminal-state
  cases); add the tail-helper test; run `npx vitest run packages/web-client/src/timeline` and
  `npx vitest run packages/web-client/src/theme`.
- Manual: dev daemon + web client; `#tool` for a streamed call, interrupt mid-`#tool` for the cancel
  path (the mock's `interrupt` emits `turn_canceled`), `#tool empty` for the empty-final edge.

## Notes

- Font sizes/spacing in new CSS must use the design-token rem ladder — raw pixel font-size literals
  fail `theme/font-scale.test.ts`.
- The `"canceled"` status is client-local only — the wire `status` string is unchanged; do not add
  it to any protocol schema. `CompactionRow` has its own `phase: "canceled"` — unrelated, do not
  share a type.
- The output-authority rule intentionally makes an old client and a new client render *different*
  finals in the empty-output edge (old keeps the last partial). That is acceptable drift on a
  cosmetic path; do not try to fix old clients.
- Sprint-059 landed first (the original draft's cross-sprint note is resolved): the card already has
  the distinct output strip and the status if-chain it anticipated, so the tail is an added block
  and `"canceled"` is a new branch — no header rebuild.
- `onToolCall` finalizes streaming assistant/reasoning rows on **every** `tool_call` (≈ L161–162),
  partials included. That matches today's start/end behavior and is harmless; leave it.
- `packages/web-client/AGENTS.md` is updated in task 007's docs sweep, not here.
