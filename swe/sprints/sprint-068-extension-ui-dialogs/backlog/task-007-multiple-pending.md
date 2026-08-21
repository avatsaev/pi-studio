# Task 007 — Several questions at once: ordering, recovered cards, past-four collapse

- **Sprint:** sprint-068-extension-ui-dialogs
- **Status:** backlog
- **Type:** feature
- **Area:** web-client / features/agent-ui
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-006

## Goal
Handle more than one dialog at a time: a stable order that never reshuffles, a visible marker on
questions recovered after a reload, and a bounded stack so twenty pending questions cannot bury the
transcript.

## Context / why
The daemon does not serialize dialogs — several extensions can hold questions open simultaneously,
and the server scope states outright that presentation order is the client's concern. Two of the
three rules here are things the SDK deliberately made cheap:

- `pendingForAgent` and `resolvedForAgent` sort by the **same** comparator, so merging them keeps a
  card's index stable across its own resolution. A card must not jump when it collapses.
- A snapshot-recovered entry has **no** `receivedAt` (live events stamp it, rehydrated ones cannot),
  which is exactly the signal the "still waiting" marker needs. No new state is required.

The third rule is a judgment the spec makes: past a small number of cards, the rest collapse behind a
counter rather than pushing the conversation off screen.

## Scope references
- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 06 (order, the recovered marker,
  the past-four collapse and its counter row, and the explicit ban on a question-history affordance)
- `swe/features/extension-ui-rpc.md` § Concurrency (dialogs are not serialized; order is a client
  concern)
- `packages/client/src/agent-ui-state.ts` — `pendingForAgent`, `resolvedForAgent` (shared
  comparator), entry `receivedAt`
- `packages/web-client/src/features/agent-ui/AskCard.tsx` (tasks 005–006)
- `packages/web-client/src/features/chat/Timeline.tsx` (the composed list from task-005)

## What to build
- Merge pending and resolved cards into one ordered list using the SDK's ordering, and render them in
  that order after the last persisted row. A card's position must not change when it resolves.
- **Recovered marker:** entries with no `receivedAt` carry the § 06 marker, indicating a question that
  was already waiting when this page loaded. Its deadline bar is the approximate one task-004 already
  returns for these entries.
- **Bounded stack:** four cards render in full; from the fifth on, each card renders **collapsed to
  its header line**, with a `N more waiting` row beneath the fourth; clicking that row expands the
  collapsed ones **in place** (§ 06: nothing is dropped or hidden behind a menu — every pending
  question stays reachable in the transcript). A newly arriving question joins the collapsed set
  and the counter updates; it must not hide without the count changing.
- No question-history UI of any kind: no "show previous questions" control, no per-card timestamp, no
  filter (§ 06 forbids each explicitly, because resolved cards are live-session-only and bounded).

## Out of scope
- Making a background session's questions discoverable (sprint-069's sidebar/tab attention). Within
  this sprint, several pending questions are only visible once the user opens that session.
- Focus behavior across multiple cards (task 008 owns which card takes focus).

## Acceptance criteria
- [ ] `#ui multi 3` renders three cards in a stable order, oldest first, each an ordinary timeline
      row (own gutter glyph, no shared frame); answering the middle one collapses it **in place**
      without moving the other two.
- [ ] Reloading the page with several questions still pending re-renders them all, each carrying the
      recovered marker, with approximate deadline bars.
- [ ] A question that arrives live after a reload shows **no** recovered marker, alongside recovered
      ones that do.
- [ ] `#ui multi 6` renders four full cards, the fifth and sixth as header lines, and a `2 more
      waiting` row beneath the fourth; clicking it expands them in place; a further arrival
      increments the count.
- [ ] No history/filter/timestamp affordance exists anywhere in the card list.
- [ ] With many cards pending, the transcript still scrolls smoothly and the bottom-anchor still
      follows live output.

## Test / verification plan
- Tests: the merge-and-bound logic is pure — put it in a module beside task-004's (e.g. the composed
  card-list builder) with a colocated test covering stable ordering across resolution, the recovered
  flag, and the collapse threshold. Run `npx vitest run packages/web-client/src/features/agent-ui/`.
- Build/typecheck/lint: `npm run build:web-client`, `npm run typecheck`, `npm run lint`,
  `npx oxfmt <changed files>`.

## Hand-off for visual sign-off (user)
Dev daemon, mock provider:
1. `#ui multi 3` — three cards, stable order. Answer the middle one; the others must not move.
2. With all three still pending, reload the browser — all three return, each with the recovered
   marker. Then run `#ui confirm` — the new card has no marker while the others keep theirs.
3. `#ui multi 6` — four full cards, two header lines, `2 more waiting` beneath the fourth; expand
   in place; raise one more and confirm the count increases.

## Notes
Ordering comes from the SDK's comparator, not from a local sort — re-sorting locally is how a card
would gain a second, divergent order and start jumping on resolution.
