# Subagents (Parent/Child Track) — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [../architecture/agent-lifecycle.md](../architecture/agent-lifecycle.md),
> [agent-sessions.md](agent-sessions.md), [mcp-server.md](mcp-server.md)

## Purpose

Agents can launch other agents (via the `create_agent` MCP tool). Non-detached children are
**subagents**: they belong to the creator's work, appear in the creator's **subagents track** (a
collapsible lane above the composer), and are cascade-archived with the parent. This feature is the
client-side model of that relationship plus the rules that decouple "close tab" from "archive" for
subagents.

## Public Contract

### Relationship
- `agent.parentAgentId` ← `labels["pi-studio.parent-agent-id"]` (set on creation unless `detached:true`).

### Track membership rule
```
parentAgentId === thisAgent.id  AND  !archivedAt
```
Archived subagents disappear from the track by design.

### Surfaces
- Subagents track component (above the composer in the parent's pane).
- Archive button (X) on each track row → confirm dialog → archive that subagent (propagates to all
  clients).

## Behavior & Algorithms

```
# Tab close behavior (client)
function handleCloseAgentTab(agent):
    if agent.parentAgentId:          # subagent
        close the tab (layout-only)   # agent stays unarchived, stays in parent's track
    else:                            # root agent
        confirm if running, then archive (global)

# Track rendering
track(parent) = agents where parentAgentId == parent.id and not archivedAt
```

- Closing a **root** agent's tab archives it (the tab is its home). Closing a **subagent**'s tab is
  layout-only and reversible (re-open from the track).
- To remove a subagent from the track, use the row's archive button (explicit lifecycle gesture).
- Cascade archive (parent → children) is handled server-side; see
  [../architecture/agent-lifecycle.md](../architecture/agent-lifecycle.md).

### Workspace activity contribution
- A running subagent contributes `running` to its **root parent's** workspace bucket, not its own
  cwd/worktree. Non-running attention/permission/error states stay in the track and do not escalate
  the workspace bucket.

## Data & Persistence
- Relationship via the `pi-studio.parent-agent-id` label on the agent record. Track membership is derived
  client-side; tabs are per-client layout (not persisted globally).

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Close subagent tab | Layout-only; stays in track on this client |
| Cross-client tab close | Other clients' layouts unaffected (archive is global) |
| Parent archived | All non-detached children cascade-archive and leave every client's track |
| Detached child | No parent label; never in the track |
| Many subagents under one parent | Track grows; no auto-cleanup (prune via archive button) |

## Dependencies
- Internal: AgentManager (labels, cascade), workspace screen tab handling, subagents track + select
  rule, MCP `create_agent`.
- External: none.

## Acceptance Criteria
- [ ] A non-detached child appears in its parent's track and disappears when archived.
- [ ] Closing a subagent tab does not archive it; closing a root agent tab does.
- [ ] The track shows exactly `parentAgentId === parent.id && !archivedAt`.
- [ ] The row archive button archives the subagent on all connected clients.
- [ ] A running subagent escalates `running` to the root parent's workspace, not its own cwd.

## TODO(verify)
- [ ] Whether detached/handoff agents ever surface in any track view.
- [ ] Track ordering and collapse-state persistence.
