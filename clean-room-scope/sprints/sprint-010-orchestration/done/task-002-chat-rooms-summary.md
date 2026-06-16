# Task 002 — Chat rooms (agent↔agent / human↔agent) — Summary

- **Sprint:** sprint-010-orchestration
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
`packages/server/src/orchestration/chat-service.ts` — `ChatService` over the shared `chat/rooms.json`
store (`loadChat`/`saveChat` from persistence; reuses the existing `chatRoomSchema`/`chatMessageSchema`):
- **`createRoom`** — rejects duplicate names case-insensitively (`duplicate_room_name`).
- **`listRooms` / `inspectRoom` / `deleteRoom`** — delete removes the room **and** all its messages.
- **`postMessage`** — `parseMentions(body)` extracts `@mention` tokens, resolves each via the injected
  `resolveMention` (unknown → dropped from `mentionAgentIds`); appends the message; bumps
  `room.updatedAt`; persists; notifies blocked waiters. Rejects posting to an unknown room.
- **`readMessages(roomId, cursor)`** — returns only messages after the cursor (index-based) + a new
  cursor.
- **`waitForMessages(roomId, sinceCursor, timeoutMs)`** — returns immediately if new messages exist,
  else blocks until a post arrives or the timeout fires (then returns empty).
- **`parseMentions`** — exported; `@[A-Za-z0-9_.:-]+`, de-duplicated.
- Added `ChatRoom`/`ChatMessage` type exports to `entity-schemas.ts` (derived from existing schemas).

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/orchestration/chat-service.ts` | created |
| `packages/server/src/orchestration/index.ts` | created |
| `packages/server/src/persistence/entity-schemas.ts` | modified (export `ChatRoom`/`ChatMessage` types) |
| `packages/server/src/index.ts` | modified (re-export orchestration) |
| `packages/server/src/orchestration/chat-service.test.ts` | added — 8 tests (real temp store) |

## Build & test results
```
$ npm run build:server                                                  → exit 0
$ npx vitest run packages/server/src/orchestration/chat-service.test.ts → 8 passed
$ npx oxlint / oxfmt --check packages/server/src/orchestration           → clean
```

## Acceptance criteria
- [x] Creating two rooms with the same name (any case) is rejected.
- [x] Posting extracts `@mentions` into `mentionAgentIds`; unknown mentions are dropped.
- [x] Reading with a cursor returns only messages after it.
- [x] Waiting returns immediately if new messages exist, else blocks (and times out to empty).
- [x] Deleting a room removes its messages (verified via reload from disk).

## Follow-ups / TODO(verify)
- Mention resolution by id vs. title (modeled as an injected resolver; default identity).
- Wait timeout semantics + cursor encoding (modeled as an index cursor; 30s default wait).
- WS/MCP/CLI handler wiring (MCP `registerTool`, CLI in sprint-011).
