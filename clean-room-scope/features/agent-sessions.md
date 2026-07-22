# Agent Sessions — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [agent-providers.md](agent-providers.md), [timeline-streaming.md](timeline-streaming.md),
> [tool-permissions.md](tool-permissions.md), [../architecture/agent-lifecycle.md](../architecture/agent-lifecycle.md),
> [subagents.md](subagents.md)

## Purpose

An **agent session** is one running instance of an agent inside a workspace: one provider, one
model, one cwd, one timeline. This feature covers creating, running (prompting), interrupting,
stopping, resuming, importing, updating, and configuring agent sessions. `AgentManager` is the
source of truth and broadcasts updates to all clients.

## Public Contract

### Create — `create_agent_request` → response
Request fields:
| Field | Type | Notes |
|-------|------|-------|
| `type` | `"create_agent_request"` | |
| `config` | AgentSessionConfig | see below |
| `env` | Record<string,string>? | extra env for the agent process |
| `workspaceId` | string? | target workspace |
| `worktreeName` | string? | launch in/with a named worktree |
| `initialPrompt` | string? | first prompt to send |
| `clientMessageId` | string? | client-owned id for the first user message |
| `outputSchema` | record? | structured-output schema for the run |
| `images` | ImageAttachment[]? | image inputs |
| `attachments` | AgentAttachments | GitHub PR/Issue attachments |
| `git` | GitSetupOptions? | git setup for the launch |
| `worktree` | CreateAgentWorktreeTarget? | create a Pi-Studio worktree for this agent |
| `autoArchive` | boolean? | archive after first terminal turn (see lifecycle) |
| `labels` | Record<string,string> | default `{}` |
| `requestId` | string | correlation id |

`AgentSessionConfig`:
| Field | Type | Notes |
|-------|------|-------|
| `provider` | string | provider id |
| `cwd` | string | working directory |
| `modeId` | string? | provider mode (plan/default/full-access/...) |
| `model` | string? | model id |
| `thinkingOptionId` | string? | reasoning level |
| `featureValues` | Record<string,unknown>? | provider feature overrides |
| `title` | string? (nullable, ≤ max chars) | explicit title |
| `approvalPolicy` | string? | provider permission policy |
| `sandboxMode` | string? | provider sandbox |
| `networkAccess` | boolean? | |
| `webSearch` | boolean? | |
| `extra` | `{ pi? }` | provider-specific config |
| `systemPrompt` | string? | custom system prompt |
| `mcpServers` | Record<string, McpServerConfig>? | MCP servers to inject |

### Other operations (session RPC families + MCP/CLI mirrors)
| Operation | Surface |
|-----------|---------|
| Send a prompt / follow-up | `send_agent_prompt` (MCP), `pi-studio send`, composer submit |
| Interrupt current turn | interrupt RPC / `pi-studio stop` / `cancel_agent`/`kill_agent` (MCP) |
| Resume a closed session | resume via `PersistenceHandle` |
| Import a provider-native session | `listImportableSessions` → `importSession` |
| Update config (model/mode/thinking/features/title) | `update_agent` (MCP), `set_agent_mode`, `pi-studio update`/`mode` |
| Reload | `pi-studio reload` |
| Wait for finish | `wait_for_agent` (MCP), `pi-studio wait` |
| Archive/delete | archive (soft), delete |

### Stream events (`AgentStreamEvent` kinds)
`user_message`, `assistant_message`, `reasoning`, `tool_call`, `turn_started`, `turn_completed`,
`turn_failed`, `turn_canceled`, `error`. Tool calls normalize to `ToolCallDetail` kinds: `shell`,
`read`, `edit`, `write`, `search`, `fetch`, `task` (and provider-specific via mapper utils).

## Behavior & Algorithms

```
function createAgent(req):
    resolve workspace/cwd (create worktree if req.worktree)
    config = validate(req.config)
    agent = AgentManager.create(config, labels, parent inheritance)
    status = initializing
    session = providerClient.createSession(config, launchContext)
    status = idle
    if req.initialPrompt: run(agent, req.initialPrompt, images, attachments, clientMessageId)
    persist + broadcast agent_update
    return { agentId, ... } correlated by requestId

function run(agent, prompt):
    status = running; broadcast
    turn = session.startTurn(prompt, options)
    for event in session.subscribe(): append to timeline; broadcast agent_stream
    on turn_completed/failed/canceled:
        status = idle (or error)
        emit canonical user_message exactly once (by provider message id)
        update attention flags; if autoArchive → archive
```

### Canonical user message rule
- Each provider adapter emits **exactly one** `user_message` timeline item per submitted foreground
  prompt, using the same message id given to / received from the provider runtime.
- Optimistic client messages are UI-only; provider transcript echoes are optional. Dedupe by
  provider-visible message id, **not** by text — use the id given to / received from the Pi runtime.

### Draft metadata
- Model/mode/command/feature lookups prefer top-level provider APIs (`listModels`, `listModes`,
  `listCommands`, `listFeatures`) over creating a scratch session.

## Data & Persistence
- Agent record + persisted timeline rows under `agents/{sanitized-cwd}/{id}.json`. `PersistenceHandle`
  enables resume. See [../architecture/persistence.md](../architecture/persistence.md).

## Error Handling & Edge Cases
| Condition | Expected behavior | Surface |
|-----------|-------------------|---------|
| Provider unavailable / binary missing | Creation fails; provider marked unavailable | `rpc_error` |
| Provider session create error | `lastStatus=error`, `lastError` set, session may stay attached | `agent_update` |
| Interrupt mid-turn | turn ends `turn_canceled`; agent returns to `idle` | stream event |
| Duplicate provider echo of a user message | Deduped by message id | — |
| `autoArchive` + worktree | Agent (and its worktree) archived after terminal turn | global archive |
| Resume with stale handle | Resume fails; surface error | `rpc_error` |
| Send prompt with no live session (e.g. after a daemon restart) | Lazily resumes from the persisted handle, then runs the turn; fails only if no persistence handle exists | `agent_prompt_response` or `rpc_error` |

## Dependencies
- Internal: AgentManager, provider registry/adapters, timeline store, permission flow, worktree
  service, structured generation (titles).
- External: agent provider CLIs/SDKs.

## Acceptance Criteria
- [ ] `create_agent_request` with `initialPrompt` creates an agent, runs the first turn, and streams events.
- [ ] Exactly one `user_message` row exists per submitted prompt, keyed by provider message id.
- [ ] Interrupting a running turn yields `turn_canceled` and returns the agent to `idle`.
- [ ] Resuming a closed agent via its `PersistenceHandle` restores the conversation.
- [ ] Importing a native provider session seeds the daemon timeline before publishing the agent.
- [ ] Updating model/mode/thinking/features persists and broadcasts without recreating the session unnecessarily.

## TODO(verify)
- [ ] Exact `send_agent_prompt`/interrupt/update RPC message type names on the wire.
- [ ] `GitSetupOptions` and `CreateAgentWorktreeTarget` field shapes.
- [ ] `outputSchema` structured-output run semantics.
