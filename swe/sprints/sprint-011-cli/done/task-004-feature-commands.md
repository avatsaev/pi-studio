# Task 004 — Feature command groups (chat/terminal/loop/schedule/permit/provider/worktree)

- **Sprint:** sprint-011-cli
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-001; sprint-010 (orchestration), sprint-009 (terminals), sprint-008 (worktrees), sprint-006 (permissions)

## Goal
Implement the remaining CLI command groups mirroring their daemon RPCs.

## Scope references
- `clean-room-scope/features/cli.md` § Command tree
- `clean-room-scope/features/chat-rooms.md`, `terminals.md`, `loops.md`, `schedules-heartbeats.md`, `tool-permissions.md`, `agent-providers.md`, `worktrees.md` (CLI mirrors)

## What to build
- `chat`: `ls`, `create`, `inspect`, `post`, `read`, `wait`, `delete`.
- `terminal`: `ls`, `create`, `capture`, `send-keys`, `kill`.
- `loop`: `run`, `ls`, `inspect`, `logs`, `stop`.
- `schedule`: `create`, `ls`, `inspect`, `update`, `pause`, `resume`, `run-once`, `logs`, `delete`.
- `permit`: `allow`, `deny`, `ls`.
- `provider`: `ls`, `models`.
- `worktree`: `create`, `ls`, `archive`.
- top-level `pi-studio <path>` (open project), `open`.

## Out of scope
- Net-new daemon behavior (each command maps to an existing RPC).

## Acceptance criteria
- [ ] Each command maps to the same RPC as its app/MCP equivalent and renders results.
- [ ] `permit ls/allow/deny` resolves pending permissions.
- [ ] `pi-studio <path>` opens a project (same flow as desktop land-on).
- [ ] `worktree create/ls/archive` manage Pi-Studio worktrees.

## Test / verification plan
- Tests: `npx vitest run packages/cli/.../feature-cmds.test.ts` against a test daemon — at least one
  command per group round-trips.

## Notes
- Exact output formats (table vs json) and per-command flags are TODO(verify).
