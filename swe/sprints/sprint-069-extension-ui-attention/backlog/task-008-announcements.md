# Task 008 — Announcements: live region, the seven strings, and the card's group name

- **Sprint:** sprint-069-extension-ui-attention
- **Status:** backlog
- **Type:** feature
- **Area:** web-client / features/agent-ui, features/sessions
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-001, task-006

## Goal
Announce pending-question state changes to assistive technology: one `aria-live="polite"` region
carrying the § 08 strings, plus the card's own `role="group"` accessible name.

## Context / why
A question appearing unprompted in a transcript is the textbook case for an announcement — the user
may be typing somewhere else entirely, and the visual signal is a small amber dot. § 08 also requires
that the state is never carried by colour alone, which the row's `needs input` label satisfies visually
and this task satisfies for screen readers.

Two constraints come straight from decisions already made elsewhere and must not be re-derived here:
every string locates by **session name** because no extension identity exists on the wire (§ 00), and
a **typed value never appears** in an announcement, the same rule § 04 applies to resolved cards.

The strings are also the app's first live region of this kind, so where the region lives and who owns
it needs deciding once rather than per surface.

## Scope references
- `swe/UI design/redesign 0.1.0/Extension Dialogs Visual Spec.html` § 08 (the announcement table: all
  seven events and their exact strings, `aria-live="polite"` on the session-row status region, "never
  announce absence", the `role="group"` name, ASK badge hidden from the a11y tree), § 04 (no typed
  values), § 00 (no extension identity)
- `swe/UI design/redesign 0.1.0/Redesign Handoff Spec.dc.html` (the existing `aria-live` status
  precedent and explicit `aria-label` conventions)
- `packages/web-client/src/features/agent-ui/` (sprint-068's cards and store; task-006's seam)
- `packages/web-client/src/features/sessions/SessionItem.tsx` (task-001's status region)

## What to build
- A single announcement region, `aria-live="polite"`, owned in one place rather than duplicated per
  row/tab/header.
- A **pure** module producing the announcement string for a state transition, covering all seven § 08
  events: question arrives in the active session (message included), arrives in another session
  (session-name locator), second-and-later in the same session (count form), answered, dismissed,
  expired, no-longer-pending — and returning nothing when nothing is pending anywhere. **Never
  announce absence:** an emptied region says nothing.
- Wire the region to the sprint-068 store so transitions produce exactly one announcement each — no
  repeats on unrelated re-renders, no announcement for a state that did not change.
- Sprint-068's card container gains `role="group"` with the § 08 accessible name (session name, not an
  extension name); the ASK badge is hidden from the accessibility tree since the group name already
  conveys it.
- Accessible names for the collapsed workspace-header dot (task-003) and the tab dot (task-004) if
  those tasks left them as TODO — the § 08 rule is that no dot is ever colour-only.
- The § 11 announcements, which live here rather than in tasks 006–007: `notify` announces as the
  message alone in the active session, `"<session name>: <message>"` for a background one — `error`
  with the more assertive politeness, `info`/`warning` polite; a background `set_editor_text`
  announces politely as `"Draft replaced in <session name>"` (the visible case is not announced —
  the on-screen note is the feedback, § 11 specifies no announcement for it).

## Out of scope
- A general-purpose app-wide announcer for unrelated features. Build it as one region for this
  feature's state; generalising it later is cheap, guessing the general contract now is not.
- Keyboard navigation to a pending question (there is none by design in these sprints).

## Acceptance criteria
- [ ] Each of the seven § 08 events produces its exact string, verified against the spec's table.
- [ ] A question arriving in the active session includes its prompt; one in another session uses the
      session-name locator instead.
- [ ] A second pending question in the same session produces the count form.
- [ ] No announcement contains a typed `input`/`editor` value, proven by a test that feeds a
      secret-looking answer.
- [ ] No extension name appears in any string.
- [ ] Clearing the last pending question announces nothing (region emptied silently).
- [ ] One announcement per transition — re-rendering the sidebar does not re-announce.
- [ ] `notify` and background `set_editor_text` announce per § 11 — right politeness per level,
      locator only for background sessions, no extension name.
- [ ] The card exposes `role="group"` with the § 08 name; the ASK badge is not announced separately.

## Test / verification plan
- Tests: the string-producing module is pure — cover all seven events, the count form, the
  no-announcement cases, and the secret-scan assertion. Transition de-duplication should also be pure
  and tested. Run `npx vitest run packages/web-client/src/features/agent-ui/`.
- Build/typecheck/lint: `npm run build:web-client`, `npm run typecheck`, `npm run lint`,
  `npx oxfmt <changed files>`.

## Hand-off for visual sign-off (user)
This one is audible rather than visual. With a screen reader on (VoiceOver/Orca/NVDA), raise
`#ui select` in the session you are viewing (prompt is read), then in a background session (locator
form), then a second one in the same session (count form). Answer one and confirm the answered string.
Resolve the last one and confirm **nothing** is announced. Then submit an `#ui input` with a
distinctive string and confirm it is never spoken.

## Notes
"Never announce absence" is easy to violate accidentally: writing an empty string into a live region
is silent, but writing a placeholder like "no questions pending" is not, and neither is toggling the
region's presence in a way that re-reads its previous content.
