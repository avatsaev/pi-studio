# Task 004 — Terminal stream binary frame codec

- **Sprint:** sprint-002-protocol
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Implement the binary frame encoder/decoder for the terminal stream protocol.

## Scope references
- `clean-room-scope/architecture/websocket-protocol.md` § Binary frames — terminal stream
- `clean-room-scope/features/terminals.md` § Binary stream protocol (terminal)

## What to build
- Create `packages/protocol/src/binary-frames/` + `terminal-stream-protocol.ts`.
- Frame layout: `[1-byte opcode][1-byte slot][payload]`.
  - Opcodes: `Output = 0x01`, `Input = 0x02`, `Resize = 0x03` (payload JSON `{ rows, cols }`),
    `Snapshot = 0x04`, plus a `Restore` opcode (value TODO(verify)).
- Encode/decode helpers returning typed frame objects; raw bytes pass through for output/input.

## Out of scope
- File-transfer frames (task-005). PTY itself (sprint-009).

## Acceptance criteria
- [ ] Encoding then decoding an `Output` frame round-trips opcode, slot, and raw bytes.
- [ ] A `Resize` frame encodes `{ rows, cols }` as JSON payload and decodes back.
- [ ] Decoder rejects/handles an unknown opcode safely.

## Test / verification plan
- Tests: `npx vitest run .../terminal-stream-protocol.test.ts` — round-trip all opcodes.

## Notes
- `slot` demuxes multiple terminals on one socket. Restore-opcode value + reflowable-snapshot payload
  are TODO(verify).
