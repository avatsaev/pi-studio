# Task 001 — Panel plug-in contract; file explorer panel

- **Sprint:** sprint-017-feature-panels-ui
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001 (sprint-015, panel registry); sprint-013 (primitives)

## Goal
Implement the shared panel plug-in contract and the file-explorer panel (tree, actions, preview entry).

## Scope references
- `clean-room-scope/features/feature-panels-ui.md` § How panels plug in, § File explorer
- `clean-room-scope/features/file-explorer-transfer.md`

## What to build
- The panel plug-in contract: how a panel registers (kind → component + descriptor hook + optional
  confirm-close), receives the pane + pane-focus context, and contributes header content.
- File-explorer panel: lazy directory tree (expand/collapse, lazy children load, sort dirs-first), entry
  rows (file-icon set + name + size/mtime where shown), refresh, hidden-file toggle; row actions
  (open preview, download, reveal, copy path); path-safety errors surfaced; loading skeleton + empty
  state; upload (drop / picker) into the current directory; the explorer-sidebar vs tab placement.

## Out of scope
- File preview content rendering (task-002). Git (task-003). Terminal (task-004). Browser + subagents
  track (task-005).

## Acceptance criteria
- [ ] A panel registers via the contract and renders inside a pane with descriptor-driven label/icon.
- [ ] The explorer lazily loads children, sorts dirs-first, toggles hidden files, and refreshes.
- [ ] Row actions (open/download/reveal/copy-path) and upload work; path-safety errors surface.

## Test / verification plan
- Tests: tree expand/lazy-load + dirs-first sort; row action wiring; upload target resolution (mock
  client).

## Notes
- Exact explorer row metadata columns are TODO(verify).
