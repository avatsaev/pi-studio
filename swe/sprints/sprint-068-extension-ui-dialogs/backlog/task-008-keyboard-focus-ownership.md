# Task 008 — Keyboard and focus ownership between a question card and the composer

- **Sprint:** sprint-068-extension-ui-dialogs
- **Status:** backlog
- **Type:** feature
- **Area:** web-client / features/agent-ui, features/chat
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-006

## Goal
Make a question card keyboard-operable without stealing keys the composer and the app already own:
Enter submits the focused card, Esc dismisses it in two deliberate steps, and focus never jumps out
from under someone who is typing.

## Context / why
Both keys are already claimed. The composer submits on bare Enter (`Composer.tsx`'s `onKeyDown`
sends unless Shift is held), and there is a global Esc that closes the topmost overlay
(`use-shortcuts.ts`). A card rendered inline in the transcript therefore sits between two existing
owners, and the user cannot tell from looking which one Enter will hit.

Getting this wrong is worse than leaving the card mouse-only: Esc dismissing a dialog sends a real
answer to a blocked extension, so an accidental keypress is a destructive action with no undo. That
is why the spec makes dismissal two-step and requires a visible hint rather than relying on the user
guessing.

## Scope references
- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 07 (focus ownership, initial
  focus, the hint line, two-step Esc, the editor's submit exception, tab order), § 02 (focus ring)
- `packages/web-client/src/features/chat/Composer.tsx` (`onKeyDown`: Enter submits unless Shift)
- `packages/web-client/src/hooks/use-shortcuts.ts` (the global Esc handler and its
  precedence)
- `packages/web-client/src/features/settings/SettingsDialog.tsx` (stacked-Esc precedent)
- `packages/web-client/src/features/agent-ui/AskCard.tsx` (tasks 005–007)

## What to build
- **Ownership rule:** a card owns Enter and Esc only while focus is inside it. Focus outside a card
  leaves both keys exactly as they behave today — the composer keeps bare-Enter submission, and the
  global Esc keeps its current precedence. No global key handler is added for cards.
- **Initial focus:** per § 07, the first pending card in the *active* session takes focus, and focus
  is never pulled out of a composer the user is already typing in.
- **Enter:** submits the focused card's primary action. In the `editor` body Enter inserts a newline
  and submission is the § 07 modifier chord instead.
- **Esc:** two-step. The first press arms dismissal with a visible change; the second confirms and
  sends the cancellation. Focus leaving the card disarms it. While a card is armed, Esc must not also
  reach the global handler.
- **Hint line:** the § 07 hint appears on the focused card showing the keys that actually apply to
  that kind — an `input` card must not advertise the editor's chord, and vice versa.
- **Tab order:** the card's controls precede the composer, per § 07.
- **Composer stand-down:** while a card holds focus the composer shows the § 07 treatment indicating
  it is not the active target.

## Out of scope
- Sidebar/tab keyboard navigation to a question in another session (sprint-069's attention work).
- Changing the composer's own Enter semantics when no card has focus, or altering the global Esc
  order for anything other than an armed card.

## Acceptance criteria
- [ ] With a pending card focused, Enter submits that card and the composer does **not** send.
- [ ] With focus in the composer, Enter still sends the message and no card reacts.
- [ ] In an `editor` card, Enter inserts a newline and the § 07 chord submits.
- [ ] Esc once arms dismissal visibly; Esc again cancels the dialog and the agent unblocks (the mock
      echoes the cancellation). One Esc alone never cancels.
- [ ] Moving focus off an armed card disarms it; a later single Esc does not cancel.
- [ ] While a card is armed, Esc does not also close an unrelated overlay.
- [ ] With no card focused, Esc behaves exactly as it does today.
- [ ] The hint line lists only the keys valid for that card's kind.
- [ ] Tab from the transcript reaches the card's controls before the composer.
- [ ] Keyboard submission produces the same in-flight spinner as a mouse press (task-006).
- [ ] Focus is visible at all times a card owns keys (visible ring, not just a colour shift).

## Test / verification plan
- Tests: put the arming/disarming state machine and the per-kind hint/key-map in pure modules beside
  task-004's, with colocated tests: which keys a kind claims, the arm→confirm→disarm transitions, and
  that an unfocused card claims nothing. Run
  `npx vitest run packages/web-client/src/features/agent-ui/`.
- Build/typecheck/lint: `npm run build:web-client`, `npm run typecheck`, `npm run lint`,
  `npx oxfmt <changed files>`.

## Hand-off for visual sign-off (user)
Dev daemon, mock provider. This is the highest-risk task for regressions in everyday use, so please
check the *existing* behavior as well as the new:
1. `#ui input` — card takes focus, hint visible; type and press Enter; it submits (composer unchanged).
2. Click into the composer with the card still pending; type and press Enter — the message sends and
   the card is untouched.
3. `#ui editor` — Enter adds newlines; the chord in the hint submits.
4. `#ui confirm` — Esc once (armed, visible), Esc again (cancelled, agent unblocks). Repeat, but move
   focus away after the first Esc, then press Esc once more — nothing is cancelled.
5. With no card pending at all, confirm Esc still closes menus/dialogs and Enter still sends — i.e.
   the app feels exactly as it did before this sprint.
6. Tab through the transcript into the card and on to the composer; focus is visible throughout.

## Notes
Start typing in the composer *while* a card is pending and unfocused — that is the case where a naive
"focus the newest card" implementation steals a keystroke mid-word. § 07's rule that focus never
leaves an active composer is the guard; verify it deliberately rather than assuming.
