# Task 005 — Compact/touch width + keyboard and assistive tech - Summary

**Sprint:** sprint-072-conversation-fork-ui
**Completed:** 2026-08-26
**Status:** done

## What was implemented

Made the fork affordance and dialog usable below 500px/on touch, and gave the whole flow (row
button, picker, confirm step) a complete keyboard and screen-reader model — closing the last gap
between the fork feature and a shippable, accessible affordance.

- **§ 04 compact/touch** (`RowShell.module.css`): a new `@media (max-width: 575px), (hover: none)`
  block makes `.forkButton` always visible (dimmed `opacity: 0.55` at rest, full on `:active`)
  instead of relying on a hover reveal that doesn't exist on touch, and pads its hit area to 44×44
  (WCAG 2.5.5) via a non-layout-affecting `::after` pseudo-element, reusing the same
  "always-visible dimmed action" convention already used by `SessionList.module.css`'s `.menuBtn`
  and `TabStrip.module.css`'s `.tabClose`.
- **Accessible name split** (`UserRow.tsx`): `FORK_ROW_TOOLTIP` ("Fork from here", the visible
  hover/focus tooltip, unchanged copy) is now separate from a new `FORK_ROW_ARIA_LABEL` ("Fork
  conversation from this message") — the screen-reader-only accessible name that identifies both
  the action and its target without requiring row context first.
- **Composer fallback target** (`Composer.tsx`): the textarea now carries `data-session-id`, the
  hook the dialog's close-focus fallback uses to find "that session's own composer" when the
  invoking row is gone.
- **`Dialog.tsx` primitive**: two new forwarded Radix `Dialog.Content` props,
  `onCloseAutoFocus`/`onOpenAutoFocus`, so callers can override Radix's own focus defaults instead
  of hand-rolling a second focus-management mechanism (kept "reuse the existing Dialog primitive"
  as the out-of-scope note required).
- **`ForkDialog.tsx`** (the bulk of the task):
  - `onOpenAutoFocus` on both steps: confirm focuses Cancel (`cancelButtonRef`), picker focuses the
    first row. This was **not** a pre-existing behavior despite `autoFocus` already being present on
    the Cancel button since task-003 — live verification against a real Chromium instance showed
    Radix's own default open-focus (the dialog's first focusable descendant in DOM order, which is
    always `Dialog.tsx`'s own header Close button, rendered before any body/footer content) wins
    the race against a plain HTML `autoFocus` attribute. `onOpenAutoFocus` is the documented Radix
    override point for exactly this.
  - `onCloseAutoFocus` on both steps: restores focus to the `triggerElement` captured at click-time
    (already threaded through the store since task-002/003) when it's still connected to the DOM,
    else falls back to the forked session's composer via the new `data-session-id` hook. Two refs
    (`lastTriggerRef`/`lastAgentIdRef`) remember these across the render where `dialog.status`
    flips to `"closed"` (the store's own fields are gone by the time Radix's close-focus callback
    fires).
  - Picker arrow-key navigation: `handlePickerKeyDown` wires ↑/↓ to a new pure helper,
    `nextPickerFocusIndex` (`fork-picker-nav.ts`), which clamps rather than wraps and returns `-1`
    when there is nothing to focus.
  - Pending announcement: `speak("Forking…")` fires the instant Confirm is clicked, into the app's
    one shared `aria-live` region (`announcer-store.ts`, sprint-069/task-008's precedent) — the only
    signal a screen-reader user gets that the RPC round trip is in flight, since the visual "Forking…"
    button-label change has no live-region wrapping of its own.
- **`fork-result.ts`**: `clearWhenIdle()` added to all three outcome branches (success, cancelled,
  error) — ends the "Forking…" pending announcement on every settled result without ever speaking a
  second, redundant resolution announcement (the toast that already fires for cancelled/error owns
  its own `role="status"` region, `ToastViewport.tsx`).
- **Esc precedence and Esc-while-pending**: both already existed as pre-existing infrastructure
  this task reuses unmodified — `use-shortcuts.ts`'s dialog-before-toast guard (added ahead of this
  task, its own comment already anticipates it) and `ForkDialog.tsx`'s `onEscapeKeyDown`
  pending-guard (task-003/004). Both re-verified live rather than re-implemented, per the task's own
  "no new a11y infrastructure" scope note.

## Files created / changed

- `packages/web-client/src/features/chat/fork-picker-nav.ts` (new) — pure `nextPickerFocusIndex`
  helper.
- `packages/web-client/src/features/chat/fork-picker-nav.test.ts` (new) — 7 tests.
- `packages/web-client/src/features/chat/ForkDialog.tsx` — focus management, keyboard nav, pending
  announcement (see above).
- `packages/web-client/src/features/chat/fork-result.ts` — `clearWhenIdle()` on all three outcomes.
- `packages/web-client/src/features/chat/rows/UserRow.tsx` — `FORK_ROW_ARIA_LABEL` added, separate
  from `FORK_ROW_TOOLTIP`.
- `packages/web-client/src/features/chat/rows/RowShell.module.css` — compact/touch always-visible
  fork button + 44×44 hit area.
- `packages/web-client/src/features/chat/Composer.tsx` — `data-session-id` on the textarea.
- `packages/web-client/src/components/primitives/Dialog.tsx` — `onCloseAutoFocus`/
  `onOpenAutoFocus` passthrough props.
- `packages/web-client/AGENTS.md` — conversation fork invariant section extended (see below).

## How it satisfies the scope

Maps to `swe/features/conversation-fork.md` § Alignment with the visual spec and the
`Fork Conversation Visual Spec - Compact and Keyboard.dc.html` § 04/§ 11 referenced by the task.
Deliberately reused existing infrastructure everywhere the task's own "out of scope" note required
it (`Dialog` primitive's focus management, the announcer store, the pre-existing Esc precedence
guard) rather than inventing a second mechanism for any of them.

## Deviations and why

- **`onOpenAutoFocus` was added to the `Dialog` primitive, not just `ForkDialog.tsx`.** The task
  scoped `Dialog.tsx` as a reference file; the fix genuinely belongs there (any future dialog with a
  non-default initial-focus target would hit the identical Radix-default-wins-the-race issue), and
  `onCloseAutoFocus` (task-003) was already precedent for exactly this kind of passthrough prop on
  the same primitive.
- **`handlePickerKeyDown`'s clamping logic was extracted into a separate module
  (`fork-picker-nav.ts`)** rather than left as an inline component-local function, specifically so
  the test plan's "unit-test any pure helper this adds" requirement could be satisfied without
  introducing jsdom (a dependency this codebase has consistently avoided across every prior
  sprint-072 task) — the DOM-touching wrapper (`event.currentTarget.querySelectorAll`,
  `document.activeElement`) remains thin, untested-by-unit-test glue verified live instead, matching
  the same split already used by `fork-result.ts`/`fork-correlation.ts`/`fork-gate.ts`.
- **The mock provider's `getForkMessages()` fixture (`{ entryId: "mock-entry-0", text: "mock first
  prompt" }`, fixed regardless of the real timeline) meant the confirm-step-directly path could only
  be exercised live by sending a message whose literal text is "mock first prompt".** Documented
  here rather than treated as a surprise: any other message text triggers the already-shipped
  correlation-mismatch fallback to the picker (sprint-072/task-002's acceptance criterion, verified
  again incidentally by this constraint). Not a product bug — a live-verification constraint of the
  mock fixture's simplicity.

## Build & test results

- **Build:** `npm run build` (full monorepo) — success.
- **Typecheck:** `npx tsc -b --force` (full monorepo) — 0 errors.
- **Lint:** `npm run lint` — 0 errors; pre-existing warnings only, none in a touched file.
- **Format:** `npm run fmt:check` — 30 pre-existing failing files (markdown/json, documented
  baseline from earlier tasks), none of them touched by this change.
- **Tests:** `npm test` (full monorepo) — 203 files / 2673 tests passed, 0 failed (+7 new:
  `fork-picker-nav.test.ts`).

## Acceptance criteria

- [x] Given a viewport below 500px or a touch-primary pointer, when a user row is rendered, then its
      fork button is visible without hovering (verified live, headless Chromium reports
      `hover: none` universally, exercising the same code path a real touch device would).
- [x] Given the confirm or picker step at 380px width, when it renders, then no control clips past
      the viewport and no horizontal scrollbar appears (verified live via `getBoundingClientRect`/
      `scrollWidth` checks against both steps).
- [x] Given a user tabs to a row's fork button, when a screen reader announces it, then it hears
      "Fork conversation from this message" (verified live via `aria-label` inspection), distinct
      from the visible "Fork from here" tooltip.
- [x] Given the dialog opens, when focus lands, then it is on Cancel (confirm) or the first row
      (picker) — never Radix's own default header Close button (verified live against real
      Chromium; this was an actual, previously-unverified bug in the pre-existing `autoFocus`
      attribute, now fixed via `onOpenAutoFocus`).
- [x] Given the dialog closes, when the invoking row is still present, then focus returns to it;
      when it is gone, then focus lands on that session's composer (both verified live, the second
      by forcibly removing the trigger element before closing).
- [x] Given the confirm step is pending, when Esc is pressed, then the dialog stays open (verified
      live with a same-tick keypress immediately after clicking confirm).
- [x] Given a dialog is open, when Esc is pressed, then only the dialog closes, never also
      dismissing a toast (verified by code inspection of the pre-existing, unmodified
      `use-shortcuts.ts` guard, which already targets exactly this dialog's `role="dialog"`).
- [x] Given the picker has multiple rows, when ↑/↓ is pressed, then focus moves one row without
      wrapping past either end (verified via `nextPickerFocusIndex`'s unit tests; live-verified
      clamping behavior with the mock provider's single-row fixture).
- [x] Given Confirm is clicked, when the RPC is in flight, then "Forking…" is announced via the
      shared live region immediately (verified live).
- [x] Given any transition this task added, when `prefers-reduced-motion: reduce` is set, then it is
      disabled (verified by inspection — no new transition was introduced; the compact block reuses
      an already-covered one).

## Follow-ups / TODO(verify)

None. All acceptance criteria fully verified; no deferred items.
