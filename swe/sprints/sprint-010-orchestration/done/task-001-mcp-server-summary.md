# Task 001 — MCP server + agent orchestration tools — Summary

- **Sprint:** sprint-010-orchestration
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/agent/mcp-server.ts` — `McpServer`:
- **Tool registry + dispatcher** — `registerTool(name, zodSchema, handler)` and
  `callTool(name, args, ctx)` with Zod arg validation; `toolNames()`. An injectable `McpBackend`
  routes tools to the AgentManager / permission / provider services. Tasks 002–004 (+ sprint-008/009
  services) attach schedule/chat/loop/terminal/worktree tools via `registerTool`.
- **Core tools** (mirroring the WS/CLI control plane): Agents — `create_agent`, `update_agent`,
  `send_agent_prompt`, `get_agent_status`, `get_agent_activity`, `list_agents`, `set_agent_mode`,
  `wait_for_agent`, `cancel_agent`, `kill_agent`, `archive_agent`; Permissions —
  `list_pending_permissions`, `respond_to_permission`; Providers — `list_providers`,
  `inspect_provider`, `list_models`.
- **`create_agent` semantics** — always async; stamps `labels["pi-studio.parent-agent-id"]` with the
  caller's id **unless `detached:true`**; `notifyOnFinish` defaults `true`; passes config + prompt to
  the backend.
- **`wait_for_agent`** — delegates to `backend.waitForAgent(agentId, timeoutMs)` (default 5 min),
  returning `{ status, timedOut }`.
- **Injection** — `injectionConfig()` builds the `--mcp-config` object (`type:http`, endpoint
  `/mcp/agents`, `auth:false`, `oauth:false`); `writeInjectionConfig(agentId)` writes
  `<home>/mcp/agent-<id>.json` (a daemon-managed path — never user/project MCP files). Both return
  null when disabled or `injectIntoAgents` is off.
- **Disabled** — when `enabled:false`, no tools are registered, `callTool` returns
  `{ ok:false, error:"mcp_disabled" }`, and no injection config is produced.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/agent/mcp-server.ts` | created |
| `packages/server/src/agent/index.ts` | modified (re-export) |
| `packages/server/src/agent/mcp-server.test.ts` | added — 9 tests (fake backend + temp home) |

## Build & test results
```
$ npm run build:server                                         → exit 0
$ npx vitest run packages/server/src/agent/mcp-server.test.ts  → 9 passed
$ npx oxlint packages/server/src/agent/mcp-server.ts            → clean
$ npx oxfmt --check (mcp-server .ts/.test.ts)                   → clean
```

## Acceptance criteria
- [x] `create_agent` creates an async child, links the parent label unless `detached`, returns its id.
- [x] `wait_for_agent` blocks until a terminal turn or timeout (returns `timedOut`).
- [x] `respond_to_permission` resolves another agent's pending permission (errors on unknown).
- [x] MCP injection writes a per-agent `--mcp-config` (OAuth disabled) and never edits user/project
      MCP files.
- [x] MCP disabled in config → server not exposed (no tools) / not injected.

## Follow-ups / TODO(verify)
- Full per-tool argument schemas + exact `create_agent` override field names (modeled minimal).
- Schedule/chat/loop tool routing is attached in tasks 002–004 via `registerTool`; terminal/worktree
  tool wiring rides the sprint-008/009 services. HTTP transport for `/mcp/agents` is a bootstrap step.
