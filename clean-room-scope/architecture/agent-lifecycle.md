# Agent Lifecycle & Archive — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [features/agent-sessions.md](../features/agent-sessions.md),
> [features/subagents.md](../features/subagents.md), [persistence.md](persistence.md),
> [features/worktrees.md](../features/worktrees.md)

## Purpose

Defines the lifecycle state machine each agent moves through, the parent/child relationship model,
and **archive** (soft delete with cascade). `AgentManager` is the single source of truth and
broadcasts state changes to all subscribed clients.

## Public Contract

### States (`lastStatus`)
| State | Meaning |
|-------|---------|
| `initializing` | provider session is being created |
| `idle` | has a live session, awaiting the next prompt |
| `running` | provider is currently producing a turn |
| `error` | last attempt failed; session still attached |
| `closed` | terminal state, no live session |

```
initializing ──> idle ⇄ running
                  │        │
                  └── error ──> closed
```
`ManagedAgent` is a discriminated union over the lifecycle tag.

### Relationship labels
- `labels["pi-studio.parent-agent-id"]` — parent agent id; set automatically when an agent is created
  via the agent-scoped `create_agent` MCP tool, unless `detached: true`. Surfaced to clients as
  `agent.parentAgentId`.

## Behavior & Algorithms

### Lifecycle status semantics
- Status stays **literal**: a parent agent is `idle` when its own turn is idle, even if a child is
  running.
- **Workspace activity** is an aggregate: a running subagent contributes `running` to its *root
  parent's* workspace, not to the subagent's own cwd/worktree. Non-running subagent
  attention/permission/error states stay in the parent's track and do **not** escalate the
  workspace bucket.

### Subagents vs. detached
- `detached: false` (or omitted) → **subagent**: part of the creator's work, appears in the
  creator's subagents track, archived with the parent.
- `detached: true` → **detached agent**: stands alone (handoffs/fire-and-forget); no
  `pi-studio.parent-agent-id`, not in the track, not archived with the creator. The creating agent is
  still used for cwd/config inheritance.
- `notifyOnFinish` defaults to `true` for agent-scoped creation.

### Archive (soft delete, global)
```
function archiveAgent(id):
    snapshot current session into the registry
    set archivedAt = now
    normalize lastStatus away from running/initializing
    notify subscribers (propagates to every connected client)
    close the runtime (kills the process if still running)
    # cascade
    for each agent a where a.labels["pi-studio.parent-agent-id"] == id:
        archiveAgent(a.id)        # recursive
```
- Archive is **global** (server-side) and propagates to all clients. The record stays on disk with
  `archivedAt` set; it disappears from active lists.
- **Auto-archive:** a create request may set `autoArchive: true`; the daemon archives the agent
  after the first terminal turn event (`turn_completed`/`turn_failed`/`turn_canceled`). If the same
  request created a Pi-Studio worktree via its `worktree` field, auto-archive also archives that
  worktree (removing the agent records inside it).

### Tabs vs. archive (client concept)
| Concept | Scope | Trigger |
|---------|-------|---------|
| Tab (workspace layout) | per-client | user opens/closes a view |
| Archive (lifecycle) | global | explicit lifecycle gesture |

- Closing a tab on a **root agent** archives it (with a confirm dialog if running) — the tab is the
  agent's home.
- Closing a tab on a **subagent** is **layout-only**: it stays unarchived and stays in the parent's
  track; can be re-opened.
- Subagents are removed from the track via the archive button (X) on the track row.

## Data & Persistence
- Reads/writes the agent record (`agentId.json`); `archivedAt`, `lastStatus`, labels are the
  lifecycle-relevant fields. See [persistence.md](persistence.md).

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Archive a running agent | Allowed; runtime closed/killed; client may show confirm |
| Archive a parent | All non-detached children cascade-archive recursively |
| Re-open closed subagent tab | Track membership preserved (not archived) |
| Long-lived parent accumulates subagents | No auto-cleanup; user prunes via archive button |
| Cross-client tab dismissal | Layout-local; archive is the global gesture |

## Dependencies
- Internal: AgentManager, agent storage, worktree service (auto-archive), MCP `create_agent`.
- External: agent provider runtimes.

## Acceptance Criteria
- [ ] State transitions persist and broadcast to all subscribers.
- [ ] Archiving a parent cascades to all `pi-studio.parent-agent-id`-linked non-detached children.
- [ ] A subagent created with `detached:true` has no parent label and survives parent archive.
- [ ] `autoArchive` archives the agent after the first terminal turn event (and its worktree if any).
- [ ] Closing a root-agent tab archives; closing a subagent tab is layout-only.

## TODO(verify)
- [ ] Exact terminal-event names that trigger auto-archive vs. lifecycle normalization.
- [ ] Behavior when a detached agent's creator is archived mid-turn.
