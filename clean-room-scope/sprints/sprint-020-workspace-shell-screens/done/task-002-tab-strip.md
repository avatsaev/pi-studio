# Task 002 — Tab strip & pinned quick-launch

- **Sprint:** sprint-020-workspace-shell-screens
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001; sprint-014/task-001,004 (tab model, tab-strip, pinned targets)

## Goal
Render the workspace tab strip with width distribution, per-tab context menu, trailing/new actions,
middle-click close, and the pinned quick-launch targets (terminal/browser + custom).

## Scope references
- `clean-room-scope/features/workspace-ui.md` § tab strip, § pinned targets

## What to build
- `TabStrip`: tabs with icon + label + status/attention, width distribution (icon-min → max width) and
  overflow, active highlight, close affordance, middle-click close, tooltip; consume the sprint-014
  `tab-strip.ts` model.
- Per-tab context menu (close / close others / close to right / pin / …) via the overlay dropdown.
- Trailing new-tab actions + the pinned quick-launch buttons (default terminal + browser, plus custom
  pins) from the sprint-014 pinned-targets model + store; pin/unpin toggles persist.
- Descriptor/icon resolution through the sprint-014 panel registry (agent/draft/terminal/browser/file).

## Out of scope
- Pane/split layout (task-003). Header/switcher/bulk-close (task-004). Panel bodies (sprint-021/022).

## Acceptance criteria
- [ ] Tabs render with width distribution + overflow, active state, and status/attention.
- [ ] Context menu + middle-click close operate via the tab model; pins persist and open targets.
- [ ] New-tab actions open the correct target kinds via the panel registry.

## Test / verification plan
- Tests: width distribution + middle-click detection (reuse `tab-strip.ts`); context-menu actions;
  pin toggle persistence + open-target (reuse pinned-targets model/store).

## Notes
- Focus/close semantics come from the sprint-014 layout model consumed here.
