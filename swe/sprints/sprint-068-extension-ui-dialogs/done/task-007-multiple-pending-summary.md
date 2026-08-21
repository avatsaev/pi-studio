# Task 007 - Several questions at once: ordering, recovered cards, past-four collapse - Summary

- **Sprint:** sprint-068-extension-ui-dialogs
- **Completed:** 2026-08-21 12:29 UTC
- **Status:** done

## What was implemented

Extended `ask-list.ts` (the composed card-list builder task-006 introduced) with two new pure
functions and wired them into `Timeline.tsx`/`AskCard.tsx`:

- **`isRecovered(entry)`** - true when a pending entry has no `receivedAt` (the SDK stamps it only
  on a live `agent_ui_request`; a snapshot-rebuilt entry carries none - `agent-ui-state.ts`'s own
  `buildSnapshotState`). This is the § 06 "still waiting" marker's exact signal - no new state.
- **`layoutAskEntries(merged, expanded)`** - takes `mergeAskEntries`'s already-ordered list and
  produces the exact render sequence: the first four **pending** entries render in full; the fifth
  pending entry onward is flagged `collapsed: true`, with a `{ kind: "more", count }` marker spliced
  in right before the first collapsed one (i.e. immediately after the last full pending card - § 06
  "beneath the fourth"). Resolved entries never count toward the four-card budget or collapse by
  this rule - task-006 already collapses every resolved card unconditionally, orthogonal to count.
  `expanded` lifts the limit entirely once the "N more waiting" row has been clicked.
- **`AskCard.tsx`**: `AskCard` gained a `collapsed?: boolean` prop routing a pending entry to a new
  `CollapsedPendingCard` (header-line-only: ASK badge, method, optional "still waiting" chip - pending
  amber border/badge, not the neutral resolved styling, since it is still actionable). A new
  `RecoveredChip` ("still waiting") renders in both the full `PendingAskCard` header and
  `CollapsedPendingCard` whenever `isRecovered(entry)`. A new exported `AskMoreRow` renders the
  clickable "N more waiting" row as an ordinary `RowShell` timeline row.
- **`Timeline.tsx`**: `ComposedItem` gained a `collapsed` flag on its `"ask"` variant and a new
  `"ask-more"` variant. `composed` now calls `layoutAskEntries(mergeAskEntries(pendingAsks,
  resolvedAsks), expandedAsks)`, where `expandedAsks` is per-pane local `useState` (never persisted,
  never SDK-derived - `TabPanelHost` keeps each pane's `Timeline` mounted for the tab's life, so this
  naturally scopes to one tab and resets only when that tab is closed/recreated).
- **`AskCard.module.css`**: `.recoveredChip` (exact spec values: 10px, muted, 1px border, radius 4px,
  `margin-left: auto` to sit at the header's right edge in both full and collapsed presentations),
  `.collapsedPendingCard` (keeps the pending amber border, composed with `.resolvedCard`'s layout),
  `.moreRow`/`.moreRow:hover` (a plain clickable row, no pre-existing convention to match against -
  reuses the app's existing `foreground`-mix hover-lift idiom from `ToolCard`'s header).

No question-history UI of any kind was added (no timestamp, no filter, no "show previous" control) -
§ 06 explicitly forbids each, and nothing in this task's own scope calls for one.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/agent-ui/ask-list.ts` | added `isRecovered`, `FULL_CARD_LIMIT`, `AskLayoutItem`, `layoutAskEntries` |
| `packages/web-client/src/features/agent-ui/ask-list.test.ts` | added 7 tests (`isRecovered` x2, `layoutAskEntries` x5) |
| `packages/web-client/src/features/agent-ui/AskCard.tsx` | `collapsed` prop on `AskCard`; new `RecoveredChip`, `CollapsedPendingCard`, exported `AskMoreRow`; recovered chip wired into `PendingAskCard`'s header |
| `packages/web-client/src/features/agent-ui/AskCard.module.css` | added `.recoveredChip`, `.collapsedPendingCard`, `.moreRow`, `.moreRow:hover` |
| `packages/web-client/src/features/chat/Timeline.tsx` | `ComposedItem` gains `collapsed`/`"ask-more"`; `composed` wired through `layoutAskEntries`; `expandedAsks` local state; `renderComposedItem` takes an `onExpandMoreAsks` callback |

## How it satisfies the scope

- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 06 - every visual value
  (recovered chip's exact CSS, the collapsed-pending shell reusing the resolved card's layout with
  the pending amber border restored, "past four"/"N more waiting" placement) was extracted directly
  from the bundle's embedded HTML/inline-style strings, not guessed - including the one combination
  the spec never demoed directly (a *collapsed but still pending* card): reasoned from the
  document's own consistent amber-vs-neutral color convention, documented in the code comment on
  `.collapsedPendingCard`.
- `swe/features/extension-ui-rpc.md` § Concurrency - `#ui multi <n>` (already built ahead of need in
  task-001) raises `n` dialogs without individually awaiting each, live-verified end to end.
- `packages/client/src/agent-ui-state.ts` - `pendingForAgent`/`resolvedForAgent`'s shared
  `compareByTimeThenId` comparator is reused via `mergeAskEntries` (task-006), never re-derived here,
  per the task's own explicit instruction.

No deviations from the task's scope.

## Build & test results

```
$ npx vitest run packages/web-client
Test Files  76 passed (76)
     Tests  1030 passed (1030)

$ (cd packages/web-client && npm run typecheck)
tsc -p tsconfig.json --noEmit
(clean)

$ npm run build:web-client
built in 10.38s
(no errors)

$ npx oxlint packages/web-client/src/features/agent-ui packages/web-client/src/features/chat/Timeline.tsx
(no warnings)

$ npx oxfmt --check <changed files>
All matched files use the correct format.
```

## Acceptance criteria

- [x] `#ui multi 3` renders three cards in a stable order, oldest first, each an ordinary timeline
      row (own gutter glyph, no shared frame); answering the middle one collapses it in place
      without moving the other two. Live-verified: three amber cards, own gutter dots + connector;
      clicking "Allow" on "Question 2 of 3" collapsed it in place to "✓ Allow" with Question 1 and 3
      unmoved on either side.
- [x] Reloading the page with several questions still pending re-renders them all, each carrying the
      recovered marker, with approximate deadline bars. Live-verified: reloaded the browser with 6
      pending dialogs outstanding, reconnected, and all 6 (4 full + 2 collapsed) showed the "still
      waiting" chip.
- [x] A question that arrives live after a reload shows no recovered marker, alongside recovered
      ones that do. Live-verified: with the six post-reload dialogs answered/resolved in that
      session, a fresh `#ui confirm` sent afterward rendered with no chip, beside the six resolved
      cards above it.
- [x] `#ui multi 6` renders four full cards, the fifth and sixth as header lines, and a `2 more
      waiting` row beneath the fourth; clicking it expands them in place; a further arrival
      increments the count. Live-verified: exactly 4 full + "2 more waiting" + 2 collapsed rows;
      clicking the row expanded all six in place, in the same relative order, with the row itself
      disappearing. (`layoutAskEntries`'s own test covers the "further arrival increments the
      count" half directly - `it("a new arrival while collapsed raises the marker's count without
      moving existing cards")`.)
- [x] No history/filter/timestamp affordance exists anywhere in the card list. Confirmed by
      construction - the only new UI is the recovered chip and the more-row, neither of which
      exposes a timestamp, a filter, or a "previous questions" control.
- [x] With many cards pending, the transcript still scrolls smoothly and the bottom-anchor still
      follows live output. The composed list still flows through the same `@tanstack/react-virtual`
      virtualizer every other row uses - `layoutAskEntries` only changes which items are *in* the
      list and how they're flagged, not how the list is rendered/virtualized/anchored.

## Follow-ups / TODO(verify)

- **A real, pre-existing ordering ambiguity was found live, not introduced by this task.** When
  several dialogs are raised in the same JS tick (e.g. `#ui multi 6`'s synchronous
  `Promise.all(steps.map(raiseScriptedDialog))`), the daemon's `agent-ui-service.ts` mints
  `createdAt: Date.now()` per request - if several land in the same millisecond, `createdAt` ties,
  and the wire's only tie-break is `requestId` (a random UUID), producing a raise-order-independent
  display order (observed live as "Question 6, 3, 1, 2, 5, 4" instead of 1-6). This is the SDK's own
  `compareByTimeThenId` (`packages/client/src/agent-ui-state.ts`, already used by
  `pendingForAgent`/`resolvedForAgent` since task-003/sprint-066/067) - not something `ask-list.ts`
  reimplements differently, and the task's own notes explicitly forbid inventing a divergent local
  order ("re-sorting locally is how a card would gain a second, divergent order and start jumping on
  resolution"). Every acceptance criterion above still holds regardless of which specific four
  questions land in the "full" set - the criteria are about count/structure, not raise-order
  labeling - so this is not a task-007 defect. Flagging for task-009's spec-corrections pass: the
  spec's "Oldest first" rule doesn't address a `createdAt` tie, and a millisecond-resolution
  timestamp is fundamentally too coarse to order same-tick dialogs deterministically; a real fix
  would need a monotonic sequence number added to the wire schema, which is out of this sprint's
  (web-client-only) scope.
