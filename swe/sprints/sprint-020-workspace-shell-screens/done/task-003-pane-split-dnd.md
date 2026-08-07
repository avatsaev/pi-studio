# Task 003 — Pane/split tree renderer & web drag-and-drop

- **Sprint:** sprint-020-workspace-shell-screens
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** task-002; sprint-014/task-002 (pane/split model, DnD helpers)

## Goal
Render the recursive pane/split tree (max depth 4), focus + resize handling, and web drag-and-drop for
splitting/moving tabs between panes via `@dnd-kit`.

## Scope references
- `clean-room-scope/features/workspace-ui.md` § panes & splits, § drag-and-drop

## What to build
- `PaneTree` recursive renderer: split containers (row/column) with resizable dividers, leaf panes each
  hosting a tab strip (task-002) + active panel body slot; focused-pane highlight; click-to-focus
  (unless the click hit an interactive element).
- Resize via draggable dividers writing back to the sprint-014 layout store (debounced).
- `@dnd-kit` drag of a tab → drop zones (center = move into pane, edges = split to side) using the
  sprint-014 `dnd.ts` `resolvePaneDropPosition` + drag-preview; enforce max depth 4 and empty-pane
  collapse.
- Keepalive: mounted-but-hidden panel bodies per the sprint-014 LRU (cap 3) so backgrounded
  terminals/agents survive tab switches.

## Out of scope
- Header/switcher/bulk-close (task-004). Panel body content (sprint-021/022) — use placeholders here.

## Acceptance criteria
- [ ] The pane tree renders splits with resizable dividers and focus highlight; resize persists.
- [ ] Dragging a tab moves it into a pane (center) or splits to a side (edges), honoring max depth 4 and
      empty-pane collapse.
- [ ] Backgrounded panes stay mounted-hidden under the LRU cap.

## Test / verification plan
- Tests: drop-position resolution + depth/collapse rules (reuse `dnd.ts`/`layout.ts`); LRU keepalive
  mount set (reuse `keepalive.ts`); resize → layout store update.

## Notes
- Panel bodies are placeholders here; sprint-021 (timeline/composer) and sprint-022 (panels) fill them.
