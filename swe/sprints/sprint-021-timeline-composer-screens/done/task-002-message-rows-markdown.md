# Task 002 — Message rows, grouping/footers & markdown rendering

- **Sprint:** sprint-021-timeline-composer-screens
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** task-001; sprint-015/task-002,005 (row treatments, turn grouping, markdown, highlight)

## Goal
Render user/assistant message rows, turn grouping + footers, activity pills, and streaming-safe markdown
with syntax-highlighted code blocks.

## Scope references
- `clean-room-scope/features/timeline-rendering.md` § message rows, § turn footers, § markdown

## What to build
- User/assistant message bubbles (row treatments, spacing/gaps from `row-treatments.ts`), activity-log
  pills, compaction markers; turn grouping + footer labels from `turn-grouping.ts`.
- A markdown renderer using `react-markdown` + `remark-gfm` fed by the sprint-015 `markdown.ts` block
  model (streaming-safe: open fences render as live code). Code fences → `@av-pi-studio/highlight`
  tokens mapped to `--syntax-*` variables (sprint-015 `syntax-highlight.ts`).
- File-link detection in text (sprint-015 `file-links.ts`) → click opens the file in the workspace.

## Out of scope
- Tool/diff/permission cards (task-003). Composer (task-004). Rewind (task-005).

## Acceptance criteria
- [ ] User/assistant rows + activity pills + turn footers render per the models with correct gaps.
- [ ] Markdown renders headings/lists/inline/code; open code fences render live while streaming.
- [ ] Code blocks are syntax-highlighted via the highlight package; file links open in the workspace.

## Test / verification plan
- Tests: row treatment/gap mapping; turn grouping + footer labels; markdown block parse → elements
  (reuse `markdown.ts`); file-link detection (reuse `file-links.ts`).

## Notes
- Streaming correctness (partial fences) is covered by the sprint-015 markdown model; this renders it.
