# Task 002 — Pane/split model, layout store & web DnD splits

- **Sprint:** sprint-015-workspace-shell
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** task-001

## Goal
Implement the pane/split tree, the per-client layout store, the web drag-and-drop split container, and the
mounted-tab keepalive.

## Scope references
- `clean-room-scope/features/workspace-ui.md` § Pane / split model, § Mounted-tab keepalive,
  § Tab operations

## What to build
- Split data structures (pane/group/node tree + focused pane + parent-tab map); default single pane;
  max depth 4. Active-tab derivation per pane (preferred → focused → first).
- Tab operations (open focused/child/background, close + collapse empty, focus, retarget, reorder).
- Split operations: split a tab to a side, split empty (seed draft), move tab between panes (collapse
  empty source), focus/unfocus with a focus-restoration token, resize (clamped, persisted).
- The layout store (per-client persisted: layout + split sizes only).
- Web split container: recursive tree + resize handles; per-pane tab strip + mounted content; one drag
  context spanning panes (reorder, cross-pane move, edge-drop split) with insertion preview + drag overlay;
  click-to-focus (skip interactive targets); focus indicator; focus mode (hide header, emphasize pane).
- Mounted-tab LRU (cap 3): keep recent tabs mounted-but-hidden (pointer-events none) per pane / focused
  pane.
- Non-web desktop fallback: single tab strip, no DnD.

## Out of scope
- Header/actions composition (task-003). Seeding/gating + mobile switcher (task-004).

## Acceptance criteria
- [ ] Web supports drag reorder, cross-pane move, and edge-drop splitting up to depth 4; non-web/mobile
      don't split.
- [ ] The mounted-tab LRU keeps ≤3 tabs warm; background terminals/streams retain state.
- [ ] Focus restoration returns focus after a transient unfocus; resize proportions persist.

## Test / verification plan
- Tests: split-tree ops (split/move/collapse/depth cap); active-tab derivation precedence; LRU eviction;
  drop-position resolution.

## Notes
- Exact focus-mode pane rendering is TODO(verify).
