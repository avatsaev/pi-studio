# Task 002 — Styling-engine conventions, platform gating, overlay/portal infra

- **Sprint:** sprint-012-ui-foundation
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Establish the cross-cutting UI infrastructure every primitive depends on: the styling-engine rules,
platform gating + breakpoints, the hover-to-show pattern, and the overlay/portal positioning system.

## Scope references
- `clean-room-scope/architecture/design-system.md` § Breakpoints, § Platform gating, § Styling-engine
  rules, § Hover-to-show, § Overlay & portal infrastructure
- `clean-room-scope/features/ui-components.md` § 0 (conventions), § Shared overlay positioning

## What to build
- Breakpoints (`xs=0,sm=576,md=768,lg=992,xl=1200`), `useIsCompactFormFactor()` (xs|sm), and the layout
  constants (`HEADER_INNER_HEIGHT`, `WORKSPACE_SECONDARY_HEADER_HEIGHT=36`, `MAX_CONTENT_WIDTH=820`,
  `COMPACT_FORM_FACTOR_WIDTH=500`, window-control reserves, `supportsDesktopPaneSplits()` = web).
- Platform gating constants/fns (`isWeb`, `isNative`, `getIsElectron()`) and the Metro platform-extension
  convention (`.web/.native/.electron`).
- Styling-engine usage rules: theme-function styles (default), theme-prop binder for non-style props, the
  inline-geometry seam for high-churn positions, and the documented crash gotchas.
- Hover-to-show helper (`isHovered || isNative || isCompact`) with web-gated pointer handling.
- Overlay/portal infra: the web overlay root (z-order modal<toast), native portal provider, the named
  floating-panel portal host (measurable), and the shared measure→flip→align→clamp positioning routine +
  controllable-open helper.

## Out of scope
- Concrete components that use these seams (task-003,004).

## Acceptance criteria
- [ ] `useIsCompactFormFactor()` flips at the sm→md boundary; anchored overlays can reroute to bottom
      sheets on compact.
- [ ] The positioning routine flips/clamps near screen edges with the documented padding + Android offset.
- [ ] Hover-revealed controls are always visible on native/compact, hover-gated on web.
- [ ] The inline-geometry seam keeps popover position off the web CSS registry while declarative styles
      stay tracked.

## Test / verification plan
- Tests: form-factor hook at boundaries; positioning math (flip/align/clamp) unit cases; hover-visibility
  helper truth table.

## Notes
- Preserve the engine gotchas (no theme-function style on animated views; content-container not tracked).
