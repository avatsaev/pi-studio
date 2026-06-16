# Task 004 — Diff rows, permission prompts

- **Sprint:** sprint-016-timeline-and-composer-ui
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-003

## Goal
Implement the diff row renderer and the inline tool-permission request prompt.

## Scope references
- `clean-room-scope/features/timeline-rendering.md` § Diff rows, § Permission request prompt
- `clean-room-scope/features/tool-permissions.md`

## What to build
- Diff rows: render a unified/side-by-side hunk view (added/removed/context line styling via the diff
  tokens), file header + diff-stat (+adds/-dels), collapse large diffs with expand, and the platform-split
  diff scroll behavior; consume server-highlighted spans where provided (highlight package).
- Permission request prompt: an inline card for a pending tool-call permission — tool summary + the
  request detail, option buttons (allow once / allow always / deny / etc. per the permission vocabulary),
  pending/answered states, and the answer round-trip via the session client; reflect resolution (and who
  answered) once resolved.

## Out of scope
- Tool-call card frame (task-003). Markdown + syntax highlighting engine (task-005). Composer (task-006).

## Acceptance criteria
- [ ] Diffs render added/removed/context styling, a diff-stat, and collapse/expand for large hunks;
      server-provided highlight spans are used when present.
- [ ] A pending permission prompt shows the documented options, sends the answer, and reflects the
      resolved state.

## Test / verification plan
- Tests: diff hunk parsing → row model + stat; permission option set + answer payload (mock session
  client).

## Notes
- Permission option vocabulary + payload field names are TODO(verify) (mirror sprint-006/task-005).
