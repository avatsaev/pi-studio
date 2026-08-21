# Task 006 — Card lifecycle states: in-flight, resolved-collapsed, non-answerable

- **Sprint:** sprint-068-extension-ui-dialogs
- **Status:** done
- **Type:** feature
- **Area:** web-client / features/agent-ui
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-005

## Goal
Take a card through its whole life: pressed control shows in-flight, the daemon's resolution collapses
it in place with an outcome line, and a disconnected or elsewhere-answered dialog goes grey and
non-answerable instead of vanishing.

## Context / why
Every one of these states exists to prevent a specific lie. An optimistic collapse would claim an
answer that may have lost a race to another client. Removing a card on disconnect would suggest the
question went away when the agent is still blocked on it. And a resolution that arrives from another
device must land as a real outcome, not as an error.

The SDK already models all three: `submitting`/`submittedAnswer` mark a response in transit,
`answerable` is the one-way door disconnect flips, and resolved entries are retained per agent
(`resolvedForAgent`) rather than deleted. This task renders them; it decides nothing new.

## Scope references
- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 04 (resolved card: collapsed in
  place, outcome line, the 50-per-agent bound and its silent eviction), § 05 (in-flight spinner on the
  pressed control; the grey non-answerable card), § 13 (motion; "clear is instant")
- `packages/client/src/agent-ui-state.ts` — `submitting`, `submittedAnswer`, `answerable`,
  `resolvedForAgent`, `RESOLVED_HISTORY_LIMIT`
- `packages/web-client/src/features/agent-ui/outcome-line.ts` (task-004)
- `packages/web-client/src/features/agent-ui/AskCard.tsx` (task-005)

## What to build
- **In-flight:** while `submitting` is set, the pressed control shows a spinner and every other
  control on that card drops to the § 05 inert treatment. The card stays a pending card — it does
  not collapse, and no outcome is shown. `submittedAnswer` identifies which control was pressed for
  `select`/`confirm` **only** (the SDK deliberately never stores an `input`/`editor` answer); for
  those two kinds the single submit control takes the spinner from `submitting` alone — do not go
  looking for a field that intentionally does not exist.
- **Resolved:** on resolution the card collapses in place, keeping its position in the list, showing
  the outcome from `outcome-line.ts`. This applies identically whether *we* answered, another client
  answered, it timed out, or the agent was swept — the wire reason drives the copy and nothing else.
- **Non-answerable:** when `answerable` is false the card renders greyed with its controls disabled
  and stays visible. It must never be removed, and the state must clear on reconnect (a fresh
  snapshot resets `answerable`; the store's controller recreation handles it).
- Resolved cards are **live-session only** and bounded at the SDK's 50-per-agent cap, past which the
  oldest silently drops — no marker, no animation, and no "history" affordance (§ 04, § 06 forbid
  one). Per § 06, do not word or design anything as if resolution were permanent.

## Out of scope
- Ordering and multi-card layout (task 007) — this task renders one card's states.
- Keyboard-initiated submission (task 008); mouse-initiated is enough to exercise every state here.
- Any local timeout logic. A deadline bar reaching zero changes nothing on its own: only the daemon's
  resolution ends a dialog, and the bar for a snapshot-recovered card is explicitly approximate.

## Acceptance criteria
- [x] Pressing a control shows a spinner on that control, disables the card, and does **not** collapse
      it until the resolution arrives.
- [x] A resolution collapses the card in place with the correct outcome line for each of: answered
      here, answered elsewhere, cancelled, timed out.
- [x] A `select`/`confirm` outcome shows the chosen label; an `input`/`editor` outcome shows no typed
      value anywhere, including in the DOM.
- [x] Disconnecting while a card is pending greys it and disables its controls without removing it;
      reconnecting restores it to answerable.
- [x] Answering the same dialog from a second client collapses this client's card with the
      answered-elsewhere outcome, not an error.
- [x] A dialog whose deadline bar runs out stays on screen until the daemon resolves it.
- [x] Reduced-motion honoured: no spinner animation, and clearing is instant.

## Test / verification plan
- Tests: state-to-presentation decisions already live in task-004's modules; extend those tests if
  this task discovers an uncovered case (e.g. an outcome for a reason string not previously
  exercised). No component tests (no jsdom).
- Build/typecheck/lint: `npm run build:web-client`, `npm run typecheck`, `npm run lint`,
  `npx oxfmt <changed files>`.

## Hand-off for visual sign-off (user)
Dev daemon, mock provider:
1. `#ui select timeout=30`, press an option — spinner on that control, then collapse with the label.
2. `#ui input`, submit text — collapsed card shows a neutral confirmation and **no** typed text.
3. `#ui confirm`, then stop the daemon before answering — card greys, controls disabled, card stays;
   restart and reconnect — card is answerable again.
4. `#ui select`, then answer it from a second browser tab — this tab collapses with the
   answered-elsewhere outcome.
5. `#ui select timeout=10`, let it run out — card remains until the provider resolves it, then shows
   the expired outcome.
6. OS-level reduced motion on — repeat step 1; no animation, instant collapse.

## Notes
"Answered elsewhere" copy is the neutral wording § 04 settled on: the daemon returns the same signal
for a lost race, a stale id and a swept agent, so the card must not claim which one happened.
