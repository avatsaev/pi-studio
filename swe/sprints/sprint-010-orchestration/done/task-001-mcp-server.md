# Task 001 — MCP server + agent orchestration tools

- **Sprint:** sprint-010-orchestration
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-005 (sprint-005), task-005 (sprint-006), task-003 (sprint-008)

## Goal
Host the daemon's MCP server at `/mcp/agents`, inject it into agents, and expose the orchestration
tools that mirror the WS/CLI control plane.

## Scope references
- `clean-room-scope/features/mcp-server.md` § Endpoint, § Tools, § create_agent semantics, § Behavior
- `clean-room-scope/features/agent-providers.md` § MCP injection specifics
- `clean-room-scope/architecture/agent-lifecycle.md` § Subagents vs. detached

## What to build
- `agent/mcp-server.ts`: local HTTP MCP endpoint `/mcp/agents`. When `daemon.mcp.injectIntoAgents` is
  enabled, write a per-agent `--mcp-config` for Pi (adapter OAuth disabled: `auth:false`,
  `oauth:false`); never edit user/project MCP files.
- Tools (Zod-validated args routed to AgentManager/schedule/terminal/worktree services):
  Agents (`create_agent`, `update_agent`, `send_agent_prompt`, `get_agent_status`,
  `get_agent_activity`, `list_agents`, `set_agent_mode`, `wait_for_agent`, `cancel_agent`,
  `kill_agent`, `archive_agent`); Permissions (`list_pending_permissions`, `respond_to_permission`);
  Providers (`list_providers`, `inspect_provider`, `list_models`); plus schedule/terminal/worktree
  tools (handlers from their sprints).
- `create_agent`: always async (agent-scoped); stamps `labels["pi-studio.parent-agent-id"]` unless
  `detached:true`; `notifyOnFinish` defaults true; inherits cwd/config with overrides.
- `wait_for_agent`: block until a terminal turn or timeout.

## Out of scope
- Chat/schedule/loop tools' underlying services (tasks 002–004 provide them; this task wires the
  tool routing once those exist). Pi-Studio skills content.

## Acceptance criteria
- [ ] `create_agent` creates an async child, links the parent label unless `detached`, returns its id.
- [ ] `wait_for_agent` blocks until a terminal turn or timeout.
- [ ] `respond_to_permission` resolves another agent's pending permission.
- [ ] MCP injection writes a per-agent `--mcp-config` and never edits user/project MCP files.
- [ ] MCP disabled in config → server not exposed / not injected.

## Test / verification plan
- Tests: `npx vitest run .../mcp-server.test.ts` — create_agent (parent label + detached), wait_for_agent
  timeout, respond_to_permission, injection config contents.

## Notes
- Full per-tool argument schemas are TODO(verify). Schedule/terminal/worktree tool routing depends on
  tasks 002–004 + sprint-009/008 being present.
