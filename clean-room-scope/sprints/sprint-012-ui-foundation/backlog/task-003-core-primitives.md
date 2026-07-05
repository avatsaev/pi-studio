# Task 003 — Core primitives: pressables, inputs, icons, surfaces

- **Sprint:** sprint-012-ui-foundation
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** task-002

## Goal
Implement the foundational interactive + display primitives the rest of the app composes from.

## Scope references
- `clean-room-scope/features/ui-components.md` § Pressables, § Inputs & form controls, § Icons,
  § Surfaces / badges / chips / avatars, § Lists & rows

## What to build
- **Pressables:** `Button` (variants default/secondary/outline/ghost/destructive; sizes xs|sm|md|lg;
  leftIcon/trailing/loading; pressed/disabled/hover states); header toggle button (tooltip-backed icon
  button sharing the header icon slot).
- **Inputs:** `Switch` (animated toggle), `SegmentedControl<T>`, an adaptive text input (uncontrolled +
  resetKey; leaf-owned placeholder/text color), and the `Combobox` (adaptive searchable picker: desktop
  floating popover / compact bottom sheet; searchable, custom-value, keep-open, anchored, structured
  header, keyboard nav).
- **Icons:** the functional icon set sized via tokens + colored via tokens (theme-prop-bound for
  reactivity); brand/provider SVG icons + a provider-id→icon map; file-icon set for the explorer.
- **Surfaces/badges/avatars:** `Alert`, `StatusBadge`, `Shortcut` chip, project icon/avatar (image or
  deterministic colored fallback), attachment pill (hover-reveal remove).
- **Rows:** the menu-item row shape (min-height 36, leading/label/description/trailing) and the
  platform-split reorderable/sortable list primitives.

## Out of scope
- Overlays/menus/sheets/headers/feedback (task-004). Feature-specific cards.

## Acceptance criteria
- [ ] Button renders all variants/sizes/states and resolves icon color from variant.
- [ ] Switch + segmented control reflect selected/disabled/hover and consume only theme tokens.
- [ ] Combobox renders as a popover on desktop and a bottom sheet on compact, searchable, with keyboard
      nav and no initial-coords flash.
- [ ] Alert/StatusBadge/Shortcut/avatar/attachment-pill match the documented variants.

## Test / verification plan
- Tests: combobox keyboard-nav + option building; shortcut formatting per OS; deterministic avatar color;
  attachment-pill remove-visibility truth table.

## Notes
- Prefer theme-function styles + binder-wrapped icons over the discouraged all-subscribing theme hook.
