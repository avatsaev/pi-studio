# Task 002 — File preview panel

- **Sprint:** sprint-016-feature-panels-ui
- **Status:** backlog
- **Estimated size:** S
- **Depends on:** task-001; sprint-015/task-005 (markdown + highlighting)

## Goal
Implement the file-preview panel for files opened from the explorer, timeline links, or path chips.

## Scope references
- `clean-room-scope/features/feature-panels-ui.md` § File explorer (preview)
- `clean-room-scope/features/file-explorer-transfer.md`, `clean-room-scope/features/timeline-rendering.md`

## What to build
- A preview panel that loads file content via the client and renders by type: text/code (syntax-
  highlighted via the highlight package + the markdown/code leaf), markdown (rendered or raw toggle where
  documented), images (fit/zoom + lightbox), and a binary/too-large fallback (download affordance).
- Header: file name/path, size, download, copy-path, reveal-in-explorer, close.
- Loading skeleton + error (not-found / denied / too-large) states; line wrap toggle for long lines.

## Out of scope
- The explorer tree (task-001). Git diff (task-003). Terminal (task-004). Browser/subagents (task-005).

## Acceptance criteria
- [ ] Text/code previews are syntax-highlighted; images fit + open a lightbox; binary/too-large shows the
      download fallback.
- [ ] The header exposes download / copy-path / reveal / close; error + loading states render.

## Test / verification plan
- Tests: type → renderer selection; too-large/binary fallback decision; header action wiring (mock client).

## Notes
- Max-inline-preview size threshold is TODO(verify).
