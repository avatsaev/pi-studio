# Task 004 — Keyboard accessibility & focus management

- **Sprint:** sprint-028-polish-a11y
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** tasks 001–003

## Goal
Audit and fix keyboard accessibility: focus trapping in dialogs, tab order, ARIA labels,
screen reader announcements, and keyboard-only navigation through the entire app.

## Scope references
- `clean-room-scope/architecture/design-system.md` § accessibility
- `clean-room-scope/features/keyboard-shortcuts.md`

## What to build
- **Focus trap**: dialogs and sheets trap focus (Tab cycles within); Esc closes. Radix handles
  this for Radix-based overlays; manually implement for custom overlays.
- **Tab order audit**: ensure logical tab order through sidebar → header → content → footer.
  Use `tabIndex` strategically; remove from decorative elements.
- **ARIA labels**: all interactive elements have accessible names. Buttons: `aria-label` for
  icon-only buttons. Status dots: `aria-label` describing status. Live regions: toast
  announcements use `aria-live="polite"`.
- **Focus indicators**: visible focus ring (2px solid accent) on all focusable elements when
  using keyboard (`:focus-visible`). Hidden when using mouse (`:focus:not(:focus-visible)`).
- **Skip links**: "Skip to content" link at top of page for screen reader users.
- **Landmark roles**: `<nav>` for sidebar, `<main>` for content, `<aside>` for panels,
  `<header>` for workspace header.
- **Screen reader announcements**: route changes announce new page title; toasts announce
  message; agent status changes announce new status.
- **Timeline a11y**: messages have `role="log"` with `aria-live="polite"` for new messages;
  tool call cards have `role="group"` with summary labels.
- **Color contrast**: verify all text meets WCAG AA (4.5:1 for normal, 3:1 for large text)
  against the dark theme backgrounds.

## Acceptance criteria
- [ ] Entire app navigable by keyboard alone (Tab + Enter + Escape + arrows).
- [ ] All interactive elements have accessible names (no empty buttons).
- [ ] Dialogs trap focus; Esc closes.
- [ ] Visible focus indicators on keyboard navigation.
- [ ] Color contrast meets WCAG AA.

## Test / verification plan
- Keyboard walkthrough: Tab through entire app → verify all elements reachable.
- Screen reader: use VoiceOver/NVDA → verify announcements make sense.
- Contrast: run automated contrast checker on all component states.
- Focus trap: open dialog → Tab → verify focus stays within.
