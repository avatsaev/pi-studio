# MCP Server — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [agent-sessions.md](agent-sessions.md), [tool-permissions.md](tool-permissions.md),
> [schedules-heartbeats.md](schedules-heartbeats.md), [terminals.md](terminals.md),
> [worktrees.md](worktrees.md), [agent-providers.md](agent-providers.md)

> **Implementation status (verified 2026-08-20): NOT DELIVERED — surface only.**
> Everything below is the intended contract, not shipped behavior. `packages/server/src/agent/
> mcp-server.ts` holds the tool registry, `create_agent` semantics, and the injection-config
> generator (sprint-010/task-001, fully unit-tested). **Nothing else exists**: no HTTP route serves
> `/mcp/agents` in either bootstrap, no `McpBackend` is implemented in production code, there is no
> `daemon.mcp` config section, and although `buildPiArgs` accepts a `mcpConfigPath`, all three Pi
> spawn sites pass only `appendSystemPrompt` — so no agent is ever handed a `--mcp-config`.
> Sprint-010/task-001's own summary deferred the transport as "a bootstrap step"; that step was
> never taken, so **no agent has ever called any tool listed here.**
>
> Two non-trivial problems a wiring sprint must solve (neither is a simple hookup):
> 1. `McpServer.callTool()` is a plain dispatcher, **not** an MCP protocol implementation — a real
>    endpoint needs JSON-RPC plus the `initialize`/`tools/list`/`tools/call` handshake over
>    streamable HTTP or SSE. That layer does not exist.
> 2. `injectionConfig()` hardcodes `auth: false, oauth: false`, but the daemon's HTTP server is
>    built with `authenticate: (req) => auth.authenticateHttp(req)` and production binds
>    `0.0.0.0:6767` by default. Serving these tools unauthenticated would expose `create_agent`/
>    `kill_agent`/`send_agent_prompt` to the network. Bind to loopback or carry a token.
>
> Knock-on: [subagents.md](subagents.md)'s agent-initiated spawning has never run either —
> `PARENT_AGENT_ID_LABEL` is written by exactly one production line (`mcp-server.ts:196`, inside the
> dormant `create_agent` tool). The parent-label cascade and workspace rollup that consume it are
> real and tested, and would work the moment MCP is mounted.

## Purpose

The daemon hosts a Model Context Protocol (MCP) server so agents can orchestrate other agents and
control the daemon: create/inspect/prompt agents, manage schedules/heartbeats, terminals, worktrees,
and permissions. This is what powers handoffs, advisors, committees, and loops from *inside* an
agent conversation. The server is injected into agents when `daemon.mcp.injectIntoAgents` is enabled
(written to a per-agent `--mcp-config` for Pi).

## Public Contract

### Endpoint
- Local HTTP MCP endpoint at `/mcp/agents` on the daemon. For Pi, injected via a generated
  per-agent `--mcp-config` with adapter OAuth disabled for this local server.

### Tools (names)
| Domain | Tools |
|--------|-------|
| Agents | `create_agent`, `update_agent`, `send_agent_prompt`, `get_agent_status`, `get_agent_activity`, `list_agents`, `set_agent_mode`, `wait_for_agent`, `cancel_agent`, `kill_agent`, `archive_agent` |
| Permissions | `list_pending_permissions`, `respond_to_permission` |
| Providers/models | `list_providers`, `inspect_provider`, `list_models` |
| Schedules | `create_schedule`, `create_heartbeat`, `update_schedule`, `inspect_schedule`, `list_schedules`, `pause_schedule`, `resume_schedule`, `delete_schedule`, `schedule_logs` |
| Terminals | `create_terminal`, `list_terminals`, `capture_terminal`, `send_terminal_keys`, `kill_terminal` |
| Worktrees | `create_worktree`, `list_worktrees`, `archive_worktree` |

### `create_agent` semantics
- Always **asynchronous** when agent-scoped.
- Stamps `labels["pi-studio.parent-agent-id"]` on the created agent unless `detached: true`.
- `notifyOnFinish` defaults to `true`.
- Inherits cwd/config from the creating agent; accepts overrides (provider, model, mode, prompt,
  worktree, autoArchive, etc.).

## Behavior & Algorithms

```
on tool call (e.g. create_agent):
    validate args (Zod)
    route to the daemon subsystem (AgentManager / schedule / terminal / worktree services)
    for create_agent: create child (async), link parent label unless detached, return agent id
    for wait_for_agent: block until the target agent reaches a terminal turn (or timeout)
    for respond_to_permission: resolve a pending permission for another agent
    return structured MCP result
```

- The tool set mirrors the WebSocket/CLI surface so an agent has the same control plane as a human
  operator. Subagent relationships, cascade archive, and notify-on-finish follow
  [../architecture/agent-lifecycle.md](../architecture/agent-lifecycle.md).
- Skills shipped with Pi-Studio (`/pi-studio-handoff`, `/pi-studio-loop`, `/pi-studio-advisor`, `/pi-studio-committee`)
  teach agents to use these tools.

## Data & Persistence
- No dedicated store; operates on the same agent/schedule/terminal/worktree stores as the rest of the
  daemon.

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| MCP disabled in config | Server not exposed / not injected |
| Pi without the `pi-mcp-adapter` extension for the cwd | No MCP injection; agent still runs |
| `wait_for_agent` on a never-finishing agent | Returns on timeout |
| `create_agent` with `detached:true` | No parent label; not in track; survives parent archive |
| Permission tool for unknown requestId | Error result |

## Dependencies
- Internal: AgentManager, schedule/terminal/worktree services, permission flow, runtime MCP
  config injection.
- External: MCP transport (HTTP for the local `/mcp/agents` server; injected into Pi via `--mcp-config`).

## Acceptance Criteria
- [ ] `create_agent` creates an async child, links the parent label unless `detached`, and returns its id.
- [ ] `wait_for_agent` blocks until a terminal turn or timeout.
- [ ] Schedule/terminal/worktree tools mutate the same state as their WS/CLI equivalents.
- [ ] `respond_to_permission` resolves another agent's pending permission.
- [ ] MCP injection writes a per-agent `--mcp-config` for Pi and never edits user/project MCP files.

## TODO(verify)
- [ ] Full argument schema per tool.
- [ ] Exact `create_agent` override field names and defaults.
