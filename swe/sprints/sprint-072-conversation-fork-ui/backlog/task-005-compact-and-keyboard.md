# Task 005 — Compact/touch width + keyboard and assistive tech

- **Sprint:** sprint-072-conversation-fork-ui
- **Status:** backlog
- **Type:** feature
- **Area:** web-client/features/chat, web-client styles
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-003

## Goal

Make the fork affordance and dialog usable below 500px and on touch, and give them a complete
keyboard and screen-reader model.

## Context / why

A hover-revealed affordance has no hover on touch, so § 04 specifies what replaces it — this is a
real behavioral branch, not styling polish. § 11 owns focus ownership and announcement, which the
dialog cannot be shipped without: it is a modal that steals focus and must return it.

These are acceptance criteria of the feature, not follow-ups.

## Scope references

- `swe/features/conversation-fork.md` § Alignment with the visual spec
- `swe/UI design/fork-rewind-ui-specs/Fork Conversation Visual Spec - Compact and Keyboard.dc.html`
  § 04 (compact/touch under 500px), § 11 (keyboard and assistive tech)
- `packages/web-client/src/hooks/use-shortcuts.ts` — the Esc precedence guard (dialog before toast)
- `packages/web-client/src/components/primitives/Dialog.tsx`
- `packages/web-client/src/features/chat/Timeline.tsx`

## What to build

- **§ 04 compact/touch:** implement the spec's replacement for hover reveal below 500px and on
  touch-primary pointers (`@media (hover: none)` / the project's existing breakpoint convention),
  and the dialog's compact layout at that width.
- **§ 11 keyboard/assistive tech:**
  - the row affordance is reachable and activatable by keyboard, with a discernible accessible name
    naming the action (not just "fork");
  - the dialog carries the correct role and is labelled by its heading; focus moves into it on open
    and **returns to the invoking row's button** on close (or to a stable fallback if that row is
    gone after the reset);
  - Esc closes the dialog and — per the existing precedence guard in `use-shortcuts.ts` — consumes
    that keystroke exclusively, so it does not also dismiss a toast;
  - the picker step's list is keyboard-navigable with the spec's keys, and the in-flight state is
    announced rather than only shown as a spinner.

## Out of scope

- New a11y infrastructure — reuse the existing `Dialog` primitive's focus management and the
  announcer store rather than inventing a second mechanism.
- Anything in § 10 motion beyond respecting `prefers-reduced-motion` where the existing primitives
  already do.

## Acceptance criteria

- [ ] Below 500px and with a touch-primary pointer, the affordance is reachable without hover, per
      § 04.
- [ ] The dialog is usable at compact width — no clipped controls, no horizontal scroll.
- [ ] The row affordance is keyboard-reachable and has an accessible name identifying both the action
      and its target message.
- [ ] Opening the dialog moves focus into it; closing returns focus to the invoking control, or to a
      stable fallback when that row no longer exists after the timeline reset.
- [ ] Esc closes the dialog and does not simultaneously dismiss a toast.
- [ ] The picker list is fully keyboard-navigable; the pending state is announced to assistive tech.
- [ ] `prefers-reduced-motion` is respected by any transition this feature adds.

## Test / verification plan

- Build: `npm run build:web-client` succeeds.
- Tests: unit-test any pure helper this adds (e.g. the accessible-name builder); assert the Esc
  precedence behavior at the store level. Run `npx vitest run packages/web-client`.
- Manual (browser, authoritative for this task): drive the whole flow **keyboard-only** — reach the
  affordance, open, navigate the picker, confirm, verify focus return. Then narrow the viewport below
  500px and repeat. Verify against `- Compact and Keyboard` § 04/§ 11 at final size.
- Lint/format: `npm run lint`; `npx oxfmt <changed files>`.

## Notes

Focus return after a fork is the subtle case: the timeline resets, so the row that opened the dialog
may legitimately no longer exist (it was forked away). The fallback target must be deterministic —
decide it here and record the choice, rather than leaving focus on `document.body`.
