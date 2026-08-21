# Task 006 — Card lifecycle states: in-flight, resolved-collapsed, non-answerable — Summary

- **Sprint:** sprint-068-extension-ui-dialogs
- **Completed:** 2026-08-21 12:07 UTC
- **Status:** done

## What was implemented

`AskCard.tsx` now renders every state the SDK already models (`agent-ui-state.ts`), not just the
pending-idle state task-005 shipped:

- **In-flight.** A new `ask-list.ts` module (`mergeAskEntries`) merges an agent's pending and
  resolved dialogs into one ordered list, keyed and sorted by the SDK's own `createdAt`/`requestId`
  comparator — the same key both lists already sort by — so a card's position never changes when it
  moves from `pending` to `resolved`. `Timeline.tsx` now composes this merged list instead of pending
  alone. Each body component (`SelectBody`/`ConfirmBody`/`InputBody`/`EditorBody`/`UnrecognisedBody`)
  tracks which control it clicked in local React state (`pressedIndex`/`pressed`) — the SDK's
  `submittedAnswer` only exists for `select`/`confirm` and would be ambiguous for duplicate select
  labels anyway, and `editor`'s two controls (Submit/Cancel) both flow through the same `submitting`
  flag with no SDK field distinguishing which was clicked, so local "which button did I press" state
  is the only correct signal for all five card kinds. A `controlOverride` helper turns
  `(entry, isPressed)` into the right Button props: the pressed control gets `loading` + a
  `style={{opacity:1}}` override (CSS opacity always compounds down the render tree, so this is what
  stops it looking artificially dim); every other control keeps Button's own built-in disabled-opacity
  (the § 05 "45%" inert look) with no extra work.
- **Resolved.** `ResolvedAskCard` renders the collapsed-in-place card using `outcome-line.ts`
  (task-004's already-tested decision module) verbatim: neutral border/badge, method name, and the
  outcome span (checkmark + `statusSuccess` for a genuine local answer, muted grey otherwise),
  truncated at 40% width for a `select` answer's arbitrary string. `outcomeLine`'s existing rules
  already prevent every typed value or invented claim from surfacing — this task only wires them in.
- **Non-answerable.** `PendingAskCard` gates the whole card behind `entry.answerable`: `.cardInert`
  applies a single `opacity: 0.55` at the card level (every control's own opacity is forced back to
  1 via inline style so nothing compounds), the border and ASK badge go neutral (reusing the same
  `.askBadgeNeutral`/neutral-border styling as the resolved card — spec's "amber implies actionable"
  rule applies to both), and a "● Reconnecting — you can answer again in a moment" note renders as a
  **sibling** of the card (not nested inside it), matching § 05 exactly.
- `Button.module.css`'s loading-spinner `@keyframes piSpin` animation had no
  `prefers-reduced-motion` guard at all — a genuine pre-existing gap this task's own "no spinner
  animation" acceptance criterion required fixing at the primitive (every `<Button loading>` in the
  app was affected, not just this card).

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/agent-ui/ask-list.ts` | created — `mergeAskEntries`/`askEntryKey` |
| `packages/web-client/src/features/agent-ui/ask-list.test.ts` | created — 5 tests |
| `packages/web-client/src/features/agent-ui/AskCard.tsx` | rewritten — `AskCard` dispatches on `AskEntry.kind`; `ResolvedAskCard` added; `PendingAskCard` (renamed from the old top-level `AskCard`) gains non-answerable/in-flight treatment; every body component gains local pressed-state tracking |
| `packages/web-client/src/features/agent-ui/AskCard.module.css` | added `.cardInert`, `.askDiscInert`, `.reconnectingNote`, `.reconnectingDot`, `.resolvedCard`, `.askBadgeNeutral`, `.resolvedMethodName`, `.outcome`, `.outcomeSuccess`, `.outcomeText` |
| `packages/web-client/src/features/chat/Timeline.tsx` | `ComposedItem`'s `"ask"` variant now carries an `AskEntry` (from `ask-list.ts`) instead of a raw `AgentUiPendingEntry`; wires in `useAgentUiResolved` + `mergeAskEntries` |
| `packages/web-client/src/components/primitives/Button.module.css` | added a `prefers-reduced-motion` guard on `.loadingSpinner`'s animation (pre-existing gap) |

## How it satisfies the scope

- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 04 (resolved card exact
  markup/colors extracted directly from the bundle's embedded HTML strings — `border-color`,
  badge `surface3`/`foregroundMuted`, outcome `statusSuccess`/`foregroundMuted`, 40%-width
  truncation), § 05 (in-flight pressed-control spinner + 45%-opacity siblings; non-answerable
  55%-opacity whole card, neutral border/badge, "Reconnecting" sibling note verified verbatim
  against the spec's embedded copy), § 13 (motion — reduced-motion guard added to `Button`).
- `packages/client/src/agent-ui-state.ts` — `submitting`, `submittedAnswer`, `answerable`,
  `resolvedForAgent`, `RESOLVED_HISTORY_LIMIT` are read as-is; no new state decisions were made here
  (task's own scope boundary — "it decides nothing new").
- `outcome-line.ts` (task-004) supplies every outcome string/tone/glyph verbatim.

No deviations from the task's scope.

## Build & test results

```
$ npx vitest run packages/web-client/src/features/agent-ui
Test Files  6 passed (6)
     Tests  51 passed (51)

$ npx vitest run packages/web-client
Test Files  76 passed (76)
     Tests  1023 passed (1023)

$ (cd packages/web-client && npm run typecheck)
tsc -p tsconfig.json --noEmit
(clean)

$ npm run build:web-client
built in 10.38s
(no errors)

$ npx oxlint packages/web-client/src/features/agent-ui/AskCard.tsx packages/web-client/src/features/agent-ui/ask-list.ts \
    packages/web-client/src/features/agent-ui/ask-list.test.ts packages/web-client/src/features/chat/Timeline.tsx \
    packages/web-client/src/components/primitives/Button.module.css
(no warnings after the toSorted() fix)

$ npx oxfmt --check <changed files>
All matched files use the correct format.
```

## Acceptance criteria

- [x] Pressing a control shows a spinner on that control, disables the card, and does **not**
      collapse it until the resolution arrives. (Live-verified: `#ui confirm` pending card stayed
      pending, amber, until resolved; code review confirms `controlOverride` never touches
      `kind: "pending"` → `"resolved"` transition, which is driven solely by the SDK's own
      `agent_ui_resolved` reducer.)
- [x] A resolution collapses the card in place with the correct outcome line for each of: answered
      here, answered elsewhere, cancelled, timed out. (Live-verified: `#ui input` → "✓ answered"
      green; `#ui select timeout=30` left to expire → "expired" muted grey, collapsed in place at
      the same transcript position. "Answered elsewhere"/"cancelled" exercised by `outcome-line.ts`'s
      existing 11 tests, which this task does not modify.)
- [x] A `select`/`confirm` outcome shows the chosen label; an `input`/`editor` outcome shows no
      typed value anywhere, including in the DOM. (Live-verified via screenshot: submitting
      `SECRET-TOKEN-XYZ` to `#ui input` shows `✓ answered` on the card with no typed text — the mock
      provider's own echo message is a separate, expected transcript row, not part of the card.)
- [x] Disconnecting while a card is pending greys it and disables its controls without removing it;
      reconnecting restores it to answerable. (Live-verified for the disconnect half: stopping the
      dev daemon mid-`#ui confirm` produced the exact spec markup — 55%-opacity card, neutral
      border/badge, "Reconnecting — you can answer again in a moment" sibling note. The reconnect
      half is the SDK's `buildSnapshotState`/`disconnected` round trip, already covered by
      `packages/client/src/agent-ui-state.test.ts`'s "disconnected" describe block — this task
      renders it, per its own scope boundary, and does not re-test SDK behavior.)
- [x] Answering the same dialog from a second client collapses this client's card with the
      answered-elsewhere outcome, not an error. (Covered by `outcome-line.test.ts`'s existing
      `answer === undefined` → "no longer pending" cases, unmodified by this task.)
- [x] A dialog whose deadline bar runs out stays on screen until the daemon resolves it.
      (Live-verified: the `#ui select timeout=30` bar reached zero and the card remained visible,
      pending, until the daemon's own timeout resolved it to "expired".)
- [x] Reduced-motion honoured: no spinner animation, and clearing is instant. (`Button.module.css`'s
      new `prefers-reduced-motion` guard on `.loadingSpinner`; the resolved/non-answerable states use
      no transition/animation at all, so "clearing is instant" holds by construction.)

## Follow-ups / TODO(verify)

- None outstanding for this task. The "reconnect restores answerable" half of acceptance criterion 4
  was verified at the unit level (pre-existing SDK tests) rather than live, because the local dev
  daemon's in-memory persistence means a full process restart also destroys the agent itself
  (`agent_removed`-equivalent), not just the connection — a live reconnect-to-the-same-daemon
  scenario needs a daemon that survives its own restart (out of reach in this dev setup).
