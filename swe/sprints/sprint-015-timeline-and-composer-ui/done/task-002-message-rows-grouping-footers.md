# Task 002 — Message rows, row treatments, turn grouping & footers

- **Sprint:** sprint-015-timeline-and-composer-ui
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Implement the text/message row renderers, the per-kind row treatments, and turn grouping/spacing/footers.

## Scope references
- `clean-room-scope/features/timeline-rendering.md` § Row treatments, § Turn grouping, spacing & footers,
  § Attachments & images, § File-link chips / inline path links

## What to build
- Row treatments per kind: user message (alignment/background/avatar), assistant message (markdown body —
  rendered in task-005), system/notice rows, thinking/reasoning rows (collapsible), error rows; spacing
  and width per the doc (max content width, gutters).
- Turn grouping: group consecutive rows of a turn; suppress repeated author chrome; render the turn footer
  (timestamps, model/usage/context metadata, action affordances) per the doc.
- Attachments & images in messages (thumbnails → lightbox), file-link chips and inline path links
  (press → open file preview / explorer).

## Out of scope
- Tool-call cards (task-003). Diffs/permissions (task-004). Markdown engine + highlighting (task-005).

## Acceptance criteria
- [ ] User vs assistant vs system/thinking/error rows render with the documented alignment/treatment.
- [ ] Consecutive rows group into a turn with a single footer (timestamp/model/usage) and suppressed
      repeated chrome.
- [ ] Image attachments open a lightbox; file-link chips and inline path links open the file preview.

## Test / verification plan
- Tests: turn-grouping segmentation; footer metadata assembly; path-link detection/parse (pure helpers).

## Notes
- Exact turn-footer metadata fields are TODO(verify).
