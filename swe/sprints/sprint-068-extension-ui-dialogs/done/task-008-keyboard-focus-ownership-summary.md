# Task 008 - Keyboard and focus ownership between a question card and the composer - Summary

- **Sprint:** sprint-068-extension-ui-dialogs
- **Completed:** 2026-08-21 13:10 UTC
- **Status:** done

## What was implemented

A new pure module plus targeted `AskCard.tsx`/`Timeline.tsx` wiring, relying on CSS
`:focus-within` (not a JS focus/blur listener) for everything that is purely visual:

- **`keyboard.ts` (new)** - `submitKeyClaimsShift(method)` (true only for `editor`, the single
  source both the field's own key handler and the hint read), `computeHint(method, armed)` (the
  § 07 hint's structured content - key-chip segments normally, the arm warning string once armed),
  and `pressEscape(armed)` (the two-step Esc state machine: first press arms without resolving,
  second press disarms and resolves). Colocated tests cover the per-kind key claim, both hint
  shapes, and the arm -> resolve -> re-arm transition table.
- **Ownership rule needs no new plumbing.** `Composer.tsx`'s Enter-submit is scoped to its own
  `<textarea onKeyDown>` - a disjoint DOM subtree from any card - so a card's Enter can never reach
  it and vice versa; this was true before this task and still requires nothing here. Esc is the one
  key with an ambient listener (`use-shortcuts.ts`'s `document`-level handler), so every Esc this
  task handles calls `stopPropagation()`.
- **`AskCard.tsx`**: `PendingAskCard` gained one real piece of state (`armed`) plus three refs -
  `cardRef` (the `.card` div, for the blur-disarms check), `primaryRef` (§ 07 initial-focus target:
  the field for `input`/`editor`, the first/only button for `select`/`confirm`/empty-select/
  `unrecognised`), `dismissRef` (§ 07's "Cancel / No / Block" - `null` for the two kinds that have
  none, `input` and populated `select`). A card-level `onKeyDown` handles Esc only (arm -> move
  focus to `dismissRef`, or resolve by calling `dismissRef.current.click()` so the resolution is
  byte-for-byte the same as a mouse click on that same control - including its own in-flight-spinner
  `pressed` state; a kind with no dismiss control submits a bare `{ cancelled: true }` instead). A
  card-level `onBlur` disarms whenever focus leaves the card entirely. An initial-focus `useEffect`
  focuses `primaryRef` only when `autoFocus` is true and `document.activeElement` isn't already a
  `TEXTAREA`/`INPUT` outside the card - the composer-typing guard from the task's own "Notes"
  section. `input`'s field gained an `onKeyDown` for bare Enter (a bare `<input>` has no `<form>` to
  submit through, unlike a focused `<button>`); `editor`'s field gained one for the shift chord only
  (bare Enter is left alone - the textarea's own default newline). `Button.tsx` gained `ref` support
  (React 19 prop, still has to be read and placed manually) since three of the five body kinds need
  to focus/click a `<button>` imperatively; `TextInput`/`TextArea` already had it via `forwardRef`.
- **`AskCard.module.css`**: `.card`'s border is now neutral (`--pi-color-border`) by default -
  amber was previously unconditional; `.card:focus-within` restores the 45% amber border and adds
  the 3px 18%-opacity ring (§ 07's "Focused card"/"Composer stands down" pair reduces to one
  selector). `.hint`/`.hintKey`/`.hintSep` render the key-chip hint line; visibility is
  `.card:focus-within ~ .hint { display: flex }` - no focus/blur JS needed for showing/hiding it,
  only for its text.
- **`Timeline.tsx`**: computes `autoFocusRequestId` - the first entry of `pendingAsks` (already
  oldest-first via the SDK's own comparator) - gated on **both** halves of "a background session or
  pane never steals focus": `useSessionStore`'s `activeSessionId === session.id` (the globally
  active sidebar session) **and** `useLayoutStore`'s `layouts[workspaceCwd]?.focusedPaneId ===
  owningPaneId` (this pane currently owns keystrokes - distinct from merely being visible, since a
  split pane can show the active session while a *different* pane holds focus, e.g. the user is
  typing in a terminal). Threaded through `renderComposedItem` to the one `AskCard` whose entry
  matches.

## A bug found and fixed mid-task

The first implementation resolved every kind's second Esc with a card-invented `{ cancelled: true
}`. Live-testing `confirm` showed the outcome line render "no longer pending" instead of the
spec's "declined" - `outcome-line.ts` renders `confirm`'s "declined" only from `answer.confirmed
=== false`, not from a `cancelled` flag; the § 07 text itself says the outcome must be "the same
answer" as a click. Fixed by clicking `dismissRef.current` (real `HTMLElement.click()`, so it
reuses that control's own `onSubmit` call) instead of resolving directly - `confirm`'s "No" now
sends `{ confirmed: false }` and shows "declined", exactly matching a mouse click. Kinds whose
existing Cancel button already sends `{ cancelled: true }` (`editor`, empty-`select`,
`unrecognised`) are unaffected - clicking their Cancel produces the identical payload the old code
was already sending directly.

## Files created / changed

| File | Change |
|------|--------|
| `packages/web-client/src/features/agent-ui/keyboard.ts` | new: `submitKeyClaimsShift`, `computeHint`, `pressEscape` |
| `packages/web-client/src/features/agent-ui/keyboard.test.ts` | new: 9 tests |
| `packages/web-client/src/features/agent-ui/AskCard.tsx` | `autoFocus` prop; `PendingAskCard` gains `armed` state, `cardRef`/`primaryRef`/`dismissRef`, Esc/blur handlers, `HintLine`; every body kind wires `primaryRef`/`dismissRef`; `input`/`editor` gain field-level `onKeyDown` |
| `packages/web-client/src/features/agent-ui/AskCard.module.css` | `.card`'s default border now neutral; new `.card:focus-within` (border+ring); new `.hint`/`.hintKey`/`.hintSep` |
| `packages/web-client/src/features/chat/Timeline.tsx` | `autoFocusRequestId` computed from `useSessionStore`+`useLayoutStore`, threaded through `renderComposedItem` to `AskCard` |
| `packages/web-client/src/components/primitives/Button.tsx` | added `ref` support (React 19 prop) |

## How it satisfies the scope

- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 07 - every rule (ownership by
  focus, initial focus, two-step Esc with the exact warning string, the editor's chord exception,
  tab order, the focused/composer-stands-down border+ring pair) implemented and live-verified; the
  literal demo hint markup (which lists all three key tokens including the editor's, on a
  non-editor card) was read as a legend for the section, not a per-kind-accurate sample - the
  task's own acceptance criteria ("an `input` card must not advertise the editor's chord") is the
  authoritative, more specific source, confirmed live (`input`'s hint has no `⇧↵`).
- `Composer.tsx`/`use-shortcuts.ts` - no changes to either; the composer's own Enter-submit and the
  global Esc's precedence are provably untouched (live-verified with no card pending, and with a
  card pending but the composer focused).
- `packages/server/src/agent/providers/mock/ui-script.ts` - discovered along the way that `#ui`
  script commands are parsed only on a fresh send, not on a mid-turn steer (steering a `#ui select`
  while an earlier dialog was still unanswered queued as plain text and never raised a dialog) -
  pre-existing mock behavior, unrelated to this task, not touched.

No deviations from the task's scope.

## Build & test results

```
$ npx tsc -b --force            (workspace-wide)
(clean, exit 0)

$ npx vitest run                (workspace-wide)
Test Files  184 passed (184)
     Tests  2360 passed (2360)

$ npx vitest run packages/web-client
Test Files  77 passed (77)
     Tests  1039 passed (1039)

$ npm run build:web-client
built in 10.37s
(no errors)

$ npm run lint                  (workspace-wide)
(pre-existing warnings only, none in files touched by this task)

$ npx oxfmt --check <changed files>
All matched files use the correct format.
```

## Acceptance criteria

- [x] With a pending card focused, Enter submits that card and the composer does not send.
      Live-verified: focused `input`'s field, typed a value, pressed Enter - card resolved with
      that value, composer's textarea stayed empty (no message sent).
- [x] With focus in the composer, Enter still sends the message and no card reacts. Live-verified:
      with an `input` card pending and unfocused, clicked the composer, typed, pressed Enter - the
      message sent and the card was untouched (title/field still present).
- [x] In an `editor` card, Enter inserts a newline and the § 07 chord submits. Live-verified: bare
      Enter grew the textarea's value with an embedded newline, card stayed pending; Shift+Enter
      resolved it with the full multi-line value intact.
- [x] Esc once arms dismissal visibly; Esc again cancels the dialog and the agent unblocks (the
      mock echoes the cancellation). One Esc alone never cancels. Live-verified on `confirm`: first
      Esc moved focus from "Yes" to "No" and swapped the hint to "Esc again to dismiss - the
      extension gets an empty answer"; second Esc resolved as `confirmed: false` ("declined"),
      confirmed via the mock's echoed assistant message.
- [x] Moving focus off an armed card disarms it; a later single Esc does not cancel. Live-verified:
      armed a `confirm` card, clicked into the composer, pressed Esc once more - the card's Yes/No
      buttons were still present (unresolved) and the hint had reverted to the normal
      "↵ submit · Esc dismiss".
- [x] While a card is armed, Esc does not also close an unrelated overlay. By construction -
      `stopPropagation()` on every Esc the card handles prevents it from ever reaching
      `use-shortcuts.ts`'s `document`-level listener.
- [x] With no card focused, Esc behaves exactly as it does today. Live-verified: with every card
      resolved, opened the workspace-actions menu, pressed Esc - it closed as before.
- [x] The hint line lists only the keys valid for that card's kind. Live-verified: `input`'s hint
      read "↵ submit · Esc dismiss" (no `⇧↵`); `editor`'s read "⇧↵ submit · Esc dismiss" (no bare
      `↵`) - matching `computeHint`'s per-kind test coverage.
- [x] Tab from the transcript reaches the card's controls before the composer. Live-verified:
      focused a sidebar element above the transcript and tabbed forward - the sequence landed on
      the pending `input` card's field, then its Submit button, then the composer's textarea, in
      that order.
- [x] Keyboard submission produces the same in-flight spinner as a mouse press. By construction for
      button-based kinds (Enter-on-focused-button is a native click, running the exact same
      `onClick` that sets the pressed-index/pressed-kind local state); explicit for `input`/`editor`
      (their `onKeyDown` calls the identical code path their own Submit button's `onClick` does).
- [x] Focus is visible at all times a card owns keys. Live-verified via screenshot: the card's
      amber border + ring render identically whether focus arrived by click or by Tab, since
      `:focus-within` is agnostic to input method; the browser's own native focus ring on the
      control itself layers on top.

## Follow-ups / TODO(verify)

- **Populated `select` and `input` have no dismissing control to click on the second Esc**, so
  their resolution falls back to a bare `{ cancelled: true }` rather than mirroring an existing
  button. For `select` this renders `outcome-line.ts`'s generic "no longer pending" (the same
  fallback text used for a race lost to another client) rather than a `declined`-style outcome -
  live-verified, not a regression (there was no Cancel affordance for these two kinds before this
  task either). Flagging for task-009: if a future spec revision wants a distinct "you dismissed
  this" outcome for these two kinds, `outcome-line.ts` needs a way to distinguish "cancelled by
  this client" from "resolved by another client" for `select`/`input`, which the wire does not
  currently carry.
