# Task 005 — Theme variants, custom scrollbar & final visual polish

- **Sprint:** sprint-028-polish-a11y
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** tasks 001–004

## Goal
Add light theme variant, custom styled scrollbars, and final visual polish pass across all
components for a production-ready appearance.

## Scope references
- `clean-room-scope/architecture/design-system.md` § themes, § scrollbar
- `clean-room-scope/features/white-label-branding.md`

## What to build
- **Light theme**: complete set of `--pi-*` variables for light mode. Toggle via settings +
  `prefers-color-scheme` system detection. Smooth transition on theme switch (no flash).
- **Custom scrollbar**: styled scrollbar for WebKit (thin, rounded, theme-colored track/thumb).
  Firefox: `scrollbar-width: thin; scrollbar-color`. Hidden by default, visible on hover/scroll.
  Applied to all scrollable containers (timeline, explorer, settings, code views).
- **Visual polish pass**:
  - Consistent spacing: audit all padding/margin for 4px grid alignment.
  - Border radius consistency: all cards/panels use `--pi-radius-base` or `--pi-radius-lg`.
  - Shadow consistency: dialogs use `--pi-shadow-md`; dropdowns use `--pi-shadow-sm`.
  - Typography: verify font sizes follow scale (11/12/13/14/16/20/24px).
  - Icon sizes: verify all icons follow 12/14/16/20/24px scale.
  - Color usage: verify semantic colors used correctly (accent for primary actions, danger for
    destructive, warning for attention, success for completion).
- **Favicon & app title**: dynamic favicon (shows agent status dot color); document title shows
  active workspace name + agent status.
- **Print styles**: basic print stylesheet for timeline (hide chrome, expand all).

## Acceptance criteria
- [ ] Light theme works with no visual artifacts; system detection auto-switches.
- [ ] Custom scrollbars render in Chrome/Firefox/Safari; visible on hover.
- [ ] All components pass visual inspection against 4px grid, consistent radii/shadows/spacing.
- [ ] Favicon updates with agent status.

## Test / verification plan
- Theme: switch to light → verify all text readable; no color clashes.
- Scrollbar: verify visible on hover in Chrome + Firefox.
- Visual audit: screenshot every screen in both themes → manual review.
- Favicon: start agent → verify favicon changes to green dot.
