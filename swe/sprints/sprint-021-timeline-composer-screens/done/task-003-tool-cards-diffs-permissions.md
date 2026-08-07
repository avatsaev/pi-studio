# Task 003 — Tool-call cards, diff rows & permission prompts

- **Sprint:** sprint-021-timeline-composer-screens
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** task-002; sprint-015/task-003,004 (tool cards, diff rows, permissions)

## Goal
Render tool-call cards (collapsed/expanded, status visuals), unified diff hunks inside cards, and the
tool-permission prompt UI.

## Scope references
- `clean-room-scope/features/timeline-rendering.md` § tool cards, § diffs
- `clean-room-scope/features/tool-permissions.md`

## What to build
- `ToolCard`: name/icon/summary/status from `tool-cards.ts`; shimmer while running; error styling;
  expand/collapse toggling `buildExpandedDetail` sections (read/shell/text/error/diff).
- Diff sections: render `parseDiff` hunks (add/remove/context lines, gutter line numbers, stat label)
  with syntax highlighting; unified layout (split is a git-panel concern in sprint-022).
- Permission prompt: render `buildPermissionPrompt` (question + options), submit the chosen option
  through the client, reflect pending/decided state; keep the prompt in-timeline at its row.

## Out of scope
- Git-panel diff viewer (sprint-022/task-002). Composer (task-004).

## Acceptance criteria
- [ ] Tool cards show status/summary, shimmer while running, and expand to detail sections.
- [ ] Diff sections render hunks with gutters + stat + highlighting.
- [ ] Permission prompts render options, submit a decision, and reflect pending/decided state.

## Test / verification plan
- Tests: tool-card presentation + expanded sections (reuse `tool-cards.ts`); diff parse → rows (reuse
  `diff-rows.ts`); permission prompt state machine + submit (reuse `permissions.ts`).

## Notes
- Status visuals/icons come from the sprint-015 models; keep colors on `--pi-*`/`--syntax-*` variables.
