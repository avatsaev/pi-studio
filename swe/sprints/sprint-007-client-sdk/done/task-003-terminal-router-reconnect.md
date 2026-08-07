# Task 003 — Terminal-stream router + reconnection/rehydrate

- **Sprint:** sprint-007-client-sdk
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Implement client-side demux of binary terminal frames to per-slot subscribers and the reconnection +
capability-rehydrate behavior.

## Scope references
- `clean-room-scope/architecture/client-app-runtime.md` § Layered client library (Router), § Error Handling
- `clean-room-scope/features/terminals.md` § Binary stream protocol
- `clean-room-scope/architecture/websocket-protocol.md` § Behavior (on reconnect)

## What to build
- `terminal-stream-router`: decode binary frames (sprint-002 codec) and dispatch Output/Snapshot to
  the subscriber registered for that `slot`; route input/resize outbound per slot.
- Reconnection: on socket drop, backoff reconnect; re-send `hello`; rehydrate capabilities; resume
  timelines from stored cursors (planning lives in sprint-012, the driver exposes the hooks).

## Out of scope
- Terminal UI (sprint-012). Server PTY (sprint-009). Sync planning logic (sprint-012).

## Acceptance criteria
- [ ] Output/Snapshot frames are delivered to the correct slot subscriber.
- [ ] Input/Resize frames are encoded with the right opcode + slot.
- [ ] On reconnect the driver re-handshakes and rehydrates capabilities.

## Test / verification plan
- Tests: `npx vitest run packages/client/.../terminal-router.test.ts` — slot demux + reconnect
  rehydrate (simulated drop).

## Notes
- Reconnection backoff parameters are TODO(verify).
