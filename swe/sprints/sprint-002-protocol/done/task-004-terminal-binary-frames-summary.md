# Task 004 — Terminal stream binary frame codec — Summary

- **Sprint:** sprint-002-protocol
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
Created `packages/protocol/src/binary-frames/terminal-stream-protocol.ts` (+ a `binary-frames/`
barrel) with the terminal stream binary codec:
- Frame layout `[1-byte opcode][1-byte slot][payload]`.
- `TerminalOpcode`: `Output=0x01`, `Input=0x02`, `Resize=0x03`, `Snapshot=0x04`, `Restore=0x05`
  (Restore value TODO(verify)).
- `encodeTerminalFrame` / `decodeTerminalFrame` returning typed frame objects; Output/Input/Snapshot/
  Restore carry raw `Uint8Array` payloads (pass-through); Resize carries `{ rows, cols }` UTF-8 JSON
  validated by `terminalResizeSchema`.
- `tryDecodeTerminalFrame` (returns `null`) and `TerminalFrameError` for safe handling of unknown
  opcodes / truncated frames / bad payloads.
- Uses `Uint8Array` + `TextEncoder`/`TextDecoder` so the codec runs in browser/RN as well as Node.

## Files created / changed
| File | Change |
|------|--------|
| `packages/protocol/src/binary-frames/terminal-stream-protocol.ts` | created |
| `packages/protocol/src/binary-frames/index.ts` | created (barrel) |
| `packages/protocol/src/index.ts` | modified — re-exports binary frames |
| `packages/protocol/src/binary-frames/terminal-stream-protocol.test.ts` | added — 6 tests |

## How it satisfies the scope
- **websocket-protocol.md § Binary frames — terminal stream** and **terminals.md § Binary stream
  protocol:** opcode values, the `[opcode][slot][payload]` layout, raw-byte vs. JSON-resize payloads,
  and the slot demux are reproduced exactly.

## Build & test results
```
$ npm run build:protocol      → exit 0 (no type errors)
$ npx vitest run packages/protocol/src/binary-frames/terminal-stream-protocol.test.ts
 ✓ terminal-stream-protocol.test.ts (6 tests)
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

## Acceptance criteria
- [x] Encoding then decoding an `Output` frame round-trips opcode, slot, and raw bytes.
- [x] A `Resize` frame encodes `{ rows, cols }` as a JSON payload and decodes back.
- [x] Decoder rejects/handles an unknown opcode safely (`decode` throws `TerminalFrameError`;
      `tryDecode` returns `null`); truncated frames and out-of-range slots are also rejected.

## Follow-ups / TODO(verify)
- `Restore` opcode value (`0x05`) and the reflowable-snapshot payload shape are TODO(verify) against
  the live codec; restore modes are gated by `features["terminal-restore-modes"]`.
