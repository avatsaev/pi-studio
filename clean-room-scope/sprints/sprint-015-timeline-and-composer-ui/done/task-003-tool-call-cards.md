# Task 003 — Tool-call cards

- **Sprint:** sprint-015-timeline-and-composer-ui
- **Status:** done
- **Estimated size:** L
- **Depends on:** task-002

## Goal
Implement the tool-call card family: the shared card frame and per-tool-type summaries + expanded details.

## Scope references
- `clean-room-scope/features/timeline-rendering.md` § Tool-call cards
- `clean-room-scope/features/tool-permissions.md`

## What to build
- The shared tool-call card frame: leading tool icon, tool name, one-line summary, status (pending/
  running spinner / success / error), expand/collapse; collapsed by default with a loading skeleton while
  details stream.
- Per-tool-type summary + expanded detail renderers per the doc (e.g. file read/write/edit, shell/command,
  search/grep, web/fetch, task/subagent, todo, MCP/other) — each with its summary line and its expanded
  body (args, output, file path, diff handoff, exit code, truncation).
- Status → color/iconography mapping; error details surfaced inline; long output truncation + "show more".
- Subagent/task tool cards link/handoff to the subagents track where applicable.

## Out of scope
- The diff renderer itself (task-004 — cards hand off to it). Permission prompt (task-004). Markdown +
  highlighting (task-005).

## Acceptance criteria
- [ ] Each documented tool type renders its summary line + expanded detail; status maps to the right
      icon/color.
- [ ] Cards are collapsed by default, show a skeleton while streaming, and expand to full details.
- [ ] Oversized output truncates with a "show more"; errors render inline.

## Test / verification plan
- Tests: tool-type → renderer selection + summary assembly; status mapping; truncation helper (pure).

## Notes
- The complete tool-type catalog + per-type field names are TODO(verify).
