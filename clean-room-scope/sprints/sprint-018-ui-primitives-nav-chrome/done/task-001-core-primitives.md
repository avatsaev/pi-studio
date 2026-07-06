# Task 001 — Core DOM primitives

- **Sprint:** sprint-018-ui-primitives-nav-chrome
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** sprint-017/task-002 (theme CSS bridge); sprint-012/task-003 (primitive contracts)

## Goal
Build the shared DOM component primitives that all screens compose, styled from the theme CSS variables
and matching the sprint-012 primitive contracts and Paseo's look/feel.

## Scope references
- `clean-room-scope/features/ui-components.md` § primitives
- `clean-room-scope/architecture/design-system.md` § tokens, § UI technology stack

## What to build
- Pressable/`Button` (variants: primary/secondary/ghost/destructive; sizes; pending/disabled; icon-only),
  `Text` helpers (weights/sizes/muted/ellipsis), form inputs (`TextInput`, `TextArea`, `Select`/
  `Combobox`, `Switch`, `Checkbox`), `Icon` (lucide-react wrapper honoring `iconSize` tokens),
  `Surface`/`Card`, `Avatar`, `StatusDot`, `StatusBadge`, `ShortcutHint` (kbd chips), `Spinner`,
  `Divider`, `ScrollArea` (themed scrollbar).
- CSS Modules per component reading `--pi-*` variables; a `clsx`-based variant helper.
- A `useHover()` hook (pointerenter/leave) and the compact "always reveal" rule; keyboard focus rings.
- Consume the existing sprint-012 view models (`ui/button.ts`, `ui/status-dot.ts`, `ui/combobox.ts`,
  `ui/shortcut.ts`, etc.) for state/labels; this task is the render layer only.

## Out of scope
- Overlays/portals (task-002). Nav chrome (task-003). Screen-specific components (sprint-019+).

## Acceptance criteria
- [ ] Each primitive renders with theme variables and switches correctly across variants.
- [ ] Button pending/disabled/icon-only states + Combobox open/filter/select match the sprint-012 models.
- [ ] Hover-reveal works on pointer devices and is always-on in compact layout.

## Test / verification plan
- Tests (jsdom + Testing Library): button state→class mapping; combobox filtering/selection via model;
  status dot/badge bucket→color; hover hook show/hide.

## Notes
- Keep primitives presentational; no data fetching. Match Paseo spacing/radii/typography via tokens.
