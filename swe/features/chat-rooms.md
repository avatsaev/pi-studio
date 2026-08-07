# Chat Rooms — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [mcp-server.md](mcp-server.md), [cli.md](cli.md),
> [../architecture/persistence.md](../architecture/persistence.md)

## Purpose

Chat rooms are a messaging surface for agent-to-agent and human-to-agent coordination. Agents post
messages (with `@mentions`) into named rooms; other agents read/wait for messages. Used to
orchestrate multi-agent workflows (handoffs, committees, advisors).

## Public Contract

### Operations (request → response)
| Operation | Message | MCP / CLI |
|-----------|---------|-----------|
| Create room | `ChatCreateRequest` | `pi-studio chat create` |
| List rooms | `ChatListRequest` | `pi-studio chat ls` |
| Inspect room | `ChatInspectRequest` | `pi-studio chat inspect` |
| Delete room | `ChatDeleteRequest` | `pi-studio chat delete` |
| Post message | `ChatPostRequest` | `pi-studio chat post` |
| Read messages | `ChatReadRequest` | `pi-studio chat read` |
| Wait for new messages | `ChatWaitRequest` | `pi-studio chat wait` |

### Data shapes
- `ChatRoom`: `{ id (UUID), name (unique, case-insensitive), purpose?, createdAt, updatedAt }`.
- `ChatMessage`: `{ id (UUID), roomId, authorAgentId, body, replyToMessageId?, mentionAgentIds:
  string[], createdAt }`.

## Behavior & Algorithms

```
function postMessage(roomId, authorAgentId, body, replyTo?):
    mentionAgentIds = extractMentions(body)        # parse @mentions → resolved agent ids
    msg = ChatMessage{ id, roomId, authorAgentId, body, replyToMessageId, mentionAgentIds, createdAt }
    append to messages; room.updatedAt = now
    persist; notify waiters/subscribers
    (mentioned agents may be notified per attention/notification rules)

function waitForMessages(roomId, sinceCursor):
    if new messages after cursor: return them
    else block until a new message arrives (or timeout)
```

- Room `name` is unique case-insensitively. `@mentions` are parsed from `body` into
  `mentionAgentIds` (see `chat-mentions.ts`).
- Read supports a cursor/since semantics so agents poll incrementally; wait blocks for new activity.

## Data & Persistence
- Single file `chat/rooms.json` = `{ rooms: ChatRoom[], messages: ChatMessage[] }`. See
  [../architecture/persistence.md](../architecture/persistence.md).

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Duplicate room name (case-insensitive) | Reject creation |
| Post to nonexistent room | Reject |
| `@mention` of unknown agent | Mention not resolved (dropped from `mentionAgentIds`) |
| Wait with no new messages | Block until message or timeout |
| Delete room | Remove room + its messages |

## Dependencies
- Internal: chat-service, chat-mentions, AgentManager (resolve mentions), notifications.
- External: none (file-backed).

## Acceptance Criteria
- [ ] Creating two rooms with the same name (any case) is rejected.
- [ ] Posting a message extracts `@mentions` into `mentionAgentIds`.
- [ ] Reading with a cursor returns only messages after it.
- [ ] Waiting returns immediately if new messages exist, else blocks.
- [ ] Deleting a room removes its messages.

## TODO(verify)
- [ ] Mention syntax/resolution rules (by id vs. title).
- [ ] Wait timeout semantics and cursor encoding.
