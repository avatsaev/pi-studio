# Rewind (Conversation & File Time-Travel) — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [agent-sessions.md](agent-sessions.md), [agent-providers.md](agent-providers.md),
> [timeline-streaming.md](timeline-streaming.md), [timeline-rendering.md](timeline-rendering.md),
> [composer-ui.md](composer-ui.md)

## Purpose

Rewind lets a user jump an agent's conversation and/or its workspace file changes back to the point
just before a given user message — undoing everything the agent did after that point. It is a
capability-gated feature: not every provider can rewind conversation history, file changes, or both,
so the UI only offers the modes the active agent's capability flags advertise.

> **Status note:** this feature does not yet exist anywhere in Pi-Studio's daemon/protocol scope
> (sprints 002–011 predate it). Implementing it requires a small, additive amendment to
> `packages/protocol` (a new RPC + capability flags) alongside the client UI. See § Dependencies.

## Public Contract

### Rewind modes
```ts
type RewindMode = "conversation" | "files" | "both";
```
- `conversation` — truncate the timeline back to before the target user message; the agent's next
  turn starts fresh from that point. Does not touch the filesystem.
- `files` — revert workspace file changes made after the target message (e.g. via a git-based
  checkpoint/reset), but keep the full conversation history intact.
- `both` — revert files AND truncate the conversation.

### Capability flags (provider-reported)
Extends `AgentCapabilityFlags` (see [agent-providers.md](agent-providers.md)) with three new optional
booleans, each independently gating one menu item:
```ts
interface AgentCapabilityFlags {
  // ...existing flags (supportsStreaming, supportsSessionPersistence, supportsDynamicModes,
  // supportsMcpServers, supportsReasoningStream, supportsToolInvocations)...
  supportsRewindConversation?: boolean;
  supportsRewindFiles?: boolean;
  supportsRewindBoth?: boolean;
}
```
A provider that supports none of these hides the rewind menu entirely (a user message with zero
resolvable modes renders no affordance).

### Wire contract (new RPC — proposed addition to `packages/protocol`)
```ts
// session message, dotted convention
{ type: "agent.rewind.request", requestId, agentId, messageId, mode: RewindMode }
→ { type: "agent.rewind.response", requestId,
    payload: { agentId, messageId, mode, truncatedAt?: string /* ISO */ } }
```
On success:
- `mode !== "files"` → the daemon truncates the agent's persisted timeline back to just before
  `messageId` and the client re-fetches the tail page (`fetch_agent_timeline_request`,
  `direction: "after"`, from the last known cursor) to resync.
- `mode !== "conversation"` → the daemon reverts workspace file state to a checkpoint captured at
  or before `messageId` (mechanism is provider/workspace-specific — e.g. a git stash/reset for a
  worktree-backed workspace; TODO(verify) exact checkpoint strategy for non-git workspaces).

## Behavior & Algorithms (client)

### Rewind menu (per user message)
```
items = []
if agent.capabilities.supportsRewindConversation: items += "conversation"
if agent.capabilities.supportsRewindFiles:         items += "files"
if agent.capabilities.supportsRewindBoth:           items += "both"
if items.length == 0: render nothing (no menu)
```
- Rendered as a hover-revealed (always-visible on native/compact) icon button next to a user message
  (see [timeline-rendering.md](timeline-rendering.md) § Row treatments — user message actions row),
  opening a dropdown menu with a warning header ("This will undo…") and one row per available mode.
- Selecting a mode locks the menu (spinner on the selected row, other rows disabled), calls the
  daemon, and on completion closes the menu. Errors surface as a toast; the menu does not close on
  failure (loop back to closed/idle so the user can retry).

### Post-rewind client state sync
```
onRewindSuccess(mode, agentId, messageId):
    if mode != "files":
        clear optimistic (unconfirmed) user messages from the live stream head/tail
        re-fetch the agent's timeline tail from the last known cursor to resync truncated history
    if mode is "conversation" or "both":
        if the composer is currently empty:
            restore the rewound message's original text into the composer input
            (lets the user re-send/edit the same prompt without retyping it)
```
- Restoring composer text only happens when the composer is empty (never clobbers text the user is
  already typing).
- The mutation is a single in-flight guard: a second rewind attempt while one is pending is a no-op.

## Data & Persistence
- No new client-local persistence. State is entirely daemon-authoritative (truncated timeline +
  reverted files); the client only re-syncs its cached view after a successful rewind.

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Provider supports no rewind mode | No menu rendered on any user message |
| Rewind RPC fails | Toast the error; menu returns to idle (retry allowed) |
| Composer has text when conversation/both succeeds | Do not overwrite the user's in-progress draft |
| Agent is running when rewind is requested | TODO(verify) — likely requires interrupting the turn first |
| Files-mode rewind on a non-git / non-worktree workspace | TODO(verify) — checkpoint mechanism undefined |

## Dependencies
- Internal: agent capability flags (provider manifest), timeline store/cursor, composer draft
  restore, toast system.
- **New protocol/server work required** (not covered by any existing sprint): `AgentCapabilityFlags`
  additions (`supportsRewindConversation/Files/Both`), the `agent.rewind.request/response` RPC, and a
  daemon-side implementation per provider (timeline truncation + file checkpoint/revert). Track this
  as an explicit task (see `sprints/sprint-015-timeline-and-composer-ui/backlog/task-007-rewind.md`).

## Acceptance Criteria
- [ ] The rewind menu on a user message lists exactly the modes the agent's capabilities advertise,
      and renders nothing when none are supported.
- [ ] Selecting "conversation" or "both" truncates the visible timeline and resyncs from the daemon
      (no duplicate/stale rows after truncation).
- [ ] Selecting "files" or "both" reverts workspace file changes without asking the user to confirm
      per-file (a single warning is shown before the action, in the menu header).
- [ ] The composer is only auto-filled with the rewound text when it was empty beforehand.
- [ ] A failed rewind toasts the error and leaves the menu usable for retry.

## TODO(verify)
- [ ] Exact daemon-side file-revert mechanism (git stash/reset vs a dedicated checkpoint store) and
      its behavior for non-git workspaces.
- [ ] Whether rewind is blocked/queued while the agent's current turn is running.
- [ ] Exact `agent.rewind.request/response` field names once implemented (this doc proposes a shape
      consistent with the existing RPC naming convention; treat as a starting point, not gospel).
