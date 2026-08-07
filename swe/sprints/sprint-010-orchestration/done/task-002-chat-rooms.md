# Task 002 — Chat rooms (agent↔agent / human↔agent)

- **Sprint:** sprint-010-orchestration
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-004 (sprint-003, chat store); task-004 (sprint-005, AgentManager)

## Goal
Implement chat rooms with @mention parsing, cursor reads, and blocking wait.

## Scope references
- `clean-room-scope/features/chat-rooms.md` § Operations, § Data shapes, § Behavior

## What to build
- `chat-service` over `chat/rooms.json` (`{ rooms, messages }`).
- Handlers/MCP/CLI-mirrored ops: `ChatCreateRequest`, `ChatListRequest`, `ChatInspectRequest`,
  `ChatDeleteRequest`, `ChatPostRequest`, `ChatReadRequest`, `ChatWaitRequest`.
- Room `name` unique case-insensitively. `postMessage` parses `@mentions` from `body` into
  `mentionAgentIds` (resolve via AgentManager; unknown mentions dropped); append message; bump
  `room.updatedAt`; notify waiters.
- `ChatReadRequest` cursor/since semantics; `ChatWaitRequest` returns immediately if new messages
  exist, else blocks until a message or timeout. Delete removes room + its messages.

## Out of scope
- Notification routing specifics. CLI command wiring (sprint-011).

## Acceptance criteria
- [ ] Creating two rooms with the same name (any case) is rejected.
- [ ] Posting extracts `@mentions` into `mentionAgentIds`; unknown mentions are dropped.
- [ ] Reading with a cursor returns only messages after it.
- [ ] Waiting returns immediately if new messages exist, else blocks.
- [ ] Deleting a room removes its messages.

## Test / verification plan
- Tests: `npx vitest run .../chat-service.test.ts` — dup-name reject, mention parse, cursor read,
  wait block/return, delete.

## Notes
- Mention resolution (by id vs. title) + wait timeout/cursor encoding are TODO(verify).
