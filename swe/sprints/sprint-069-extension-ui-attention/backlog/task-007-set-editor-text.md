# Task 007 — `set_editor_text`: replacing the composer draft, visibly

- **Sprint:** sprint-069-extension-ui-attention
- **Status:** backlog
- **Type:** feature
- **Area:** web-client / features/chat, features/agent-ui
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-006

## Goal
When an extension sets the editor text, the composer's draft is replaced and the replacement is
*visible*: a border flash, a note, and a caret the user can carry on typing from.

## Context / why
This is the only extension surface that mutates something the user was in the middle of using. Pi's
`set_editor_text` carries just `text`, and the SDK's decision was that it always replaces — so without
feedback, a user mid-sentence sees their draft silently swapped and reasonably concludes the app ate
it. § 11 exists to make that legible rather than to soften it.

The background-pane case matters as much: an extension can fire this for a session the user is not
looking at, and a replacement they never saw is worse than one they did. § 11 defers the flash until
the pane is next visible so the feedback is not spent on an empty room.

## Scope references
- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 11 (`set_editor_text`: the
  border flash and its timing, the note, caret placement, background-pane deferral), § 13 (reduced
  motion: the flash becomes a hold with no transition), § 00 (`set_editor_text` carries `text` only)
- `swe/features/extension-ui-client-sdk.md` § Effects (`replace_composer_text`)
- `packages/web-client/src/features/chat/Composer.tsx` (draft state and its owner)
- `packages/web-client/src/features/agent-ui/agent-ui-store.ts` (task-006's effect seam)

## What to build
- Route the composer effect through task-006's seam to **the target session's** draft — never
  whichever composer has focus.
- **Create the draft seam this needs:** today the draft is component-local state —
  `Composer.tsx:98`'s `const [text, setText] = useState("")` — with no per-session draft store, so
  there is nothing an effect can write to. Lift the draft into per-session state (or give the store
  a per-session pending-replacement slot the composer consumes) rather than reaching into a mounted
  component. A session with **no chat tab open anywhere** has no composer mounted at all: the
  incoming text must not be lost — it applies when a composer for that session next mounts.
- Replace the draft with the incoming text, place the caret **at the end** (§ 11) so typing can
  continue immediately, and show the § 11 note under the composer for 4s: *Your draft was replaced* —
  or, when the prior draft was **empty**, *Your message was filled in* (§ 11's "Empty draft" row:
  identical treatment, different copy).
- Border flash on the composer per § 11: `accentBright` 45% for 400ms, settling back; under
  `prefers-reduced-motion` it becomes a hold with no transition. No toast — the change is already
  visible where the user is looking.
- **Background-pane deferral, per § 11's exact rule:** if the target session's composer is not
  visible, apply the text immediately, show **no flash and no note** — the note (only) appears the
  first time the pane is next shown, then expires. Fire it once, not on every subsequent visit.
  The flash is never replayed for a background replacement: feedback is spent only where it is seen.
- Replacement is unconditional — no confirmation prompt, no merge with existing text, no undo
  affordance. That is the SDK's settled behavior; this task makes it visible, not negotiable.

## Out of scope
- Any undo/history for the replaced draft.
- Changing composer submission, focus rules, or sprint-068's keyboard ownership.
- Applying the effect to a terminal or file pane — this is the chat composer only.

## Acceptance criteria
- [ ] With the target session visible, the draft is replaced, the border flashes, the § 11 note
      appears with the right copy (replaced vs filled-in), and typing continues from the end of the
      new text without an extra click.
- [ ] Firing it for a **background** session replaces that session's draft, leaves the visible
      session's composer untouched, shows no flash, and shows the note when that pane is next
      opened — once.
- [ ] A session with no open chat tab still receives the text — it is present when a composer for
      that session next mounts.
- [ ] An empty incoming `text` clears the draft with the standard treatment. (§ 11 is silent on
      this case — clearing-with-note is the consistent reading of "always replaces"; record the
      decision in the summary rather than silently choosing.)
- [ ] Reduced motion: hold instead of transition; the note still appears.
- [ ] A pending question card holding focus (sprint-068/task-008) is unaffected — the replacement must
      not steal focus from a card or from a composer the user is typing in.

## Test / verification plan
- Tests: keep the deferral decision in a pure helper (visible ⇒ flash now, hidden ⇒ flash once on next
  reveal) with a colocated test; test the routing target choice (correct session's draft). Run
  `npx vitest run packages/web-client/src/features/agent-ui/ packages/web-client/src/features/chat/`.
- Build/typecheck/lint: `npm run build:web-client`, `npm run typecheck`, `npm run lint`,
  `npx oxfmt <changed files>`.

## Hand-off for visual sign-off (user)
Needs a `#ui set_editor_text` recipe added to the mock script (extend task-006's grammar addition).
Then: type a half-finished sentence in the composer, fire the effect, and confirm the replacement is
obvious rather than silent, with the caret at the end ready to type; fire it again over an empty
composer and confirm the *filled in* copy. Repeat for a background session — switch away, fire it,
switch back, and confirm you get the **note** on arrival (no flash) and not again afterwards.
Finally, with a question card focused, fire it and confirm focus does not jump.

## Notes
The most likely defect here is routing by *focus* instead of by session: it looks correct in
single-pane use and silently clobbers the wrong draft as soon as two panes are open. Verify with two
chat panes side by side.
