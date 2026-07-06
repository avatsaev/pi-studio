# Task 003 — Responsive breakpoints & compact mode

- **Sprint:** sprint-028-polish-a11y
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001; sprint-020 (compact switcher)

## Goal
Implement responsive layout breakpoints so the app works well at all viewport sizes from
narrow (tablet/small laptop) to ultra-wide, with a compact mode for ≤768px.

## Scope references
- `clean-room-scope/architecture/design-system.md` § responsive, § breakpoints
- `clean-room-scope/features/workspace-ui.md` § compact mode

## What to build
- **Breakpoint system**: CSS-variable-based breakpoints + `useBreakpoint()` hook:
  - `compact`: ≤768px (sidebar hidden, bottom tab bar, sheets instead of dialogs)
  - `regular`: 769–1200px (sidebar overlay by default, single pane workspace)
  - `wide`: >1200px (sidebar pinned, split panes allowed)
- **Sidebar behavior**: compact → hidden (replaced by CompactSwitcher bottom bar); regular →
  overlay (hamburger toggle); wide → pinned (always visible, collapsible to icon-only).
- **Workspace layout**: compact → single pane only (no splits); regular → max 2 panes;
  wide → max 4 panes. Split resize handles hidden on compact.
- **Command center**: compact → full-screen sheet; regular/wide → centered dialog.
- **Tab strip**: compact → horizontal scroll (no shrink); regular/wide → flex-shrink with
  minimum width.
- **Composer**: compact → minimal (no voice button, smaller padding); regular → full.
- **Settings**: compact → single column; wide → sidebar + content two-column layout.
- **Touch targets**: compact mode increases button/link hit areas to ≥44px.

## Acceptance criteria
- [ ] At ≤768px: sidebar hidden, bottom bar shown, single pane, sheets for overlays.
- [ ] At 769–1200px: sidebar overlay, up to 2 panes, centered dialogs.
- [ ] At >1200px: sidebar pinned, up to 4 panes, full feature set.
- [ ] Resizing the window transitions smoothly between breakpoints.

## Test / verification plan
- Resize viewport to each breakpoint → verify layout changes.
- Compact: verify touch targets ≥44px; verify bottom bar navigation works.
- Wide: verify sidebar pins; verify 4-pane split works.
