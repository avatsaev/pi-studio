# Task 002 — Tool call detail sheets & permission RPC

- **Sprint:** sprint-023-timeline-full
- **Status:** done
- **Estimated size:** L
- **Depends on:** task-001; sprint-023/task-001 (session store)

## Goal
Wire tool call cards to real detail data (expandable sections showing file reads, edits, shell
output, search results) and connect permission prompts to the daemon RPC.

## Scope references
- `clean-room-scope/features/timeline-rendering.md` § tool calls, § permissions
- `clean-room-scope/features/agent-sessions.md` § permissions

## What to build
- **Tool call detail fetching**: when user expands a tool card, fetch detail via
  `agent.toolCall.detail` RPC (if not already cached in stream item). Render expanded sections:
  - `edit` → diff viewer (unified, with syntax highlighting)
  - `read` → scrollable code surface with line numbers
  - `shell` → terminal-styled output (dark bg, mono font, ANSI color support)
  - `search` → file path list + web result cards
  - `sub_agent` → nested log with link to child session
  - `fetch` → rendered content or raw text
- **Permission RPC**: when agent requests permission, render `PermissionRow` with options; on user
  click, call `agent.permission.respond` RPC with the chosen option ID. Show loading state while
  RPC in-flight; update prompt to "resolved" on success.
- **Auto-approve settings**: if workspace has auto-approve rules (from settings), skip the prompt
  and auto-respond. Show "auto-approved" label in timeline.
- **Tool call grouping**: consecutive tool calls in a single turn group into a collapsible cluster
  with summary ("5 tool calls: 2 edits, 1 read, 2 shell").
- **Error display**: failed tool calls show error text with red accent; expandable stack trace.

## Acceptance criteria
- [ ] Expanding a tool card fetches and renders detail sections with correct formatting.
- [ ] Permission prompts submit via RPC; pending/resolved states reflect correctly.
- [ ] Tool calls group into clusters with summary; individual cards expandable.
- [ ] Errors render with red accent and expandable detail.

## Test / verification plan
- Detail: mock RPC response → verify sections render by kind.
- Permission: click "Allow" → verify RPC called → verify resolved state.
- Grouping: 5 consecutive tool calls → verify cluster summary.
