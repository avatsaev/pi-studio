# Task 001 — Explorer sidebar & file preview pane

- **Sprint:** sprint-022-feature-panel-screens
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** sprint-020, sprint-021; sprint-016/task-001,002 (explorer + preview models)

## Goal
Build the explorer sidebar (Files tab: lazy tree, sort, actions) and the file preview pane (text/code/
markdown/image/binary) as real DOM components.

## Scope references
- `clean-room-scope/features/feature-panels-ui.md` § file explorer, § file preview pane
- `clean-room-scope/features/file-explorer-transfer.md`

## What to build
- The explorer sidebar shell (Files / Changes / PR tabs; pinned on wide, overlay on compact) — this task
  implements the Files tab; git tabs come in task-002.
- `FileTree`: lazy-expand rows (indent + guides, chevron/spinner, Material-ish file icons), sort cycle
  (name/modified/size, dirs first), refresh, kebab actions (copy path, download); persist expanded +
  sort per workspace; consume the sprint-016 explorer model.
- `FilePreviewPane` (a tiled `file` tab): resolve read target, render by kind — markdown (react-markdown),
  text/code (line-gutter + syntax highlight, line deep-link highlight/scroll), image (contained),
  binary ("unavailable" + size); loading/error states. Consume the sprint-016 preview model.
- Download via the daemon token + download store; directory-unavailable + empty/error states.

## Out of scope
- Git changes/diff/PR (task-002). Terminal (task-003). Browser/subagents (task-004).

## Acceptance criteria
- [ ] The Files tree lazily lists, sorts (dirs first), persists expansion, and opens files into a preview
      tab.
- [ ] Preview renders text/code/markdown/image/binary with the correct states + line deep-link.
- [ ] Download requests a token and starts a transfer; unavailable/empty/error states render.

## Test / verification plan
- Tests: tree flatten/sort/expand (reuse sprint-016 explorer model); preview kind + read-target resolve
  (reuse preview model); download action wiring (mock client).

## Notes
- Reuse the sprint-021 markdown + highlight renderers for markdown/code previews.
