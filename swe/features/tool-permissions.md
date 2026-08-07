# Tool-Call Permissions — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [agent-sessions.md](agent-sessions.md), [agent-providers.md](agent-providers.md),
> [mcp-server.md](mcp-server.md), [cli.md](cli.md)

## Purpose

When an agent's mode requires approval, a tool call (shell command, file edit, etc.) pauses and a
**permission request** flows to connected clients for a user decision. This feature covers the
request/resolve protocol, provider modes that gate permissions, and the question-permission bridge
for providers (e.g. Pi) that ask interactive dialogs.

## Public Contract

### Flow messages
| Message | Direction | Purpose |
|---------|-----------|---------|
| `agent_permission_request` | daemon → clients | A tool call awaits approval |
| `agent_permission_resolved` | daemon → clients | Decision applied (broadcast) |
| respond-to-permission RPC | client → daemon | User decision (allow/deny/options) |

### Session contract
- `getPendingPermissions() → AgentPermissionRequest[]`
- `respondToPermission(requestId, response) → AgentPermissionResult | void`

### Permission request shape (contract)
- `requestId`, agent id, tool name / normalized `ToolCallDetail`, the proposed action
  (command/diff/path), and the available responses (allow once, deny, mode-specific options).

### MCP mirror
- `list_pending_permissions`, `respond_to_permission` (so orchestrating agents can resolve
  permissions for child agents).

### CLI mirror
- `pi-studio permit ls`, `pi-studio permit allow`, `pi-studio permit deny`.

## Behavior & Algorithms

```
provider turn:
    agent attempts a tool call
    if mode requires approval for this tool:
        create AgentPermissionRequest(requestId)
        flag the agent as awaiting user input
        broadcast agent_permission_request to all subscribers
        WAIT for respondToPermission(requestId, response)
    on response:
        apply decision to the provider session
        broadcast agent_permission_resolved
        clear the awaiting-input flag; resume the turn (or skip/deny the tool)
```

### Provider modes
- Providers expose modes (plan / default / full-access / autonomous, etc.) with a `colorTier`
  (`safe`/`moderate`/`dangerous`/`planning`). Full-access modes produce **no** permission prompts;
  ask-style modes trigger requests. E2E configs expose `getFullAccessConfig` / `getAskModeConfig`.

### Question-permission bridge (Pi and similar)
- Provider interactive dialogs (`select`, `input`, `editor`, `confirm`) are surfaced as **question
  permissions** and answered with the provider's UI-response mechanism (`extension_ui_response`).
- Chained dialogs: an `ask_user` `select` with `allowComment:true` is presented as one combined
  question; Pi-Studio answers the initial `select` immediately, then auto-answers the follow-up optional
  comment `input` with the supplied comment (or empty string).
- Preserve optional/skip semantics so the client can distinguish "skip this optional input" from
  "cancel the whole dialog." Fire-and-forget UI requests (notifications) are ignored unless
  first-class UI exists.

## Data & Persistence
- Pending permission state is in-memory on the session and surfaced live via
  `agent_permission_request` / `agent_permission_resolved`. It is not separately persisted.

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Multiple clients see the same request | First resolution wins; `agent_permission_resolved` broadcast to all |
| Client disconnects while pending | Request stays pending until another client (or MCP/CLI) resolves it |
| Agent interrupted while pending | Pending request cancelled with the turn |
| Optional input skipped | Distinguished from full-dialog cancel |
| Full-access mode | No request emitted at all |

## Dependencies
- Internal: agent session, AgentManager, session broadcast, MCP server, CLI.
- External: Pi RPC permission requests and Pi extension UI dialogs.

## Acceptance Criteria
- [ ] A tool call in ask-mode emits `agent_permission_request` and pauses the turn.
- [ ] Responding via RPC/MCP/CLI resolves it and broadcasts `agent_permission_resolved` to all clients.
- [ ] Full-access mode produces no permission requests.
- [ ] A Pi `select`+optional-comment dialog is presented as one question and auto-resolves the follow-up input.
- [ ] Resolving sets/clears the agent's permission attention flag.

## TODO(verify)
- [ ] Exact `respond_to_permission` response option vocabulary per provider.
- [ ] Permission request payload field names on the wire.
