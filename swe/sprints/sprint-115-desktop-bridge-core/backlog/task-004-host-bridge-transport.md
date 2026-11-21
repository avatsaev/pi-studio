# Task 004 — Desktop host: the bridged `Transport` in TypeScript

- **Sprint:** sprint-115-desktop-bridge-core
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src/host
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-112/task-007 (the gate passed)

## Goal
A `Transport` for the SDK whose socket is in Rust: it speaks the five commands and one channel, and behaves like the WebSocket transport from the SDK's point of view.

## Context / why
The SDK's `DaemonClient` is unchanged (T4), so every difference from a browser socket must be hidden here: frames in wire order, binary as `ArrayBuffer`, delivered synchronously, `bufferedAmount` with the meaning uploads pace on, and one `onClose` per connection.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 2, § 3, § 4 (the bridged `Transport` table)
- `packages/client/src/transport.ts` (the interface and the reference implementation, with its note on the reordering bug)
- `packages/client/src/file-transfer-client.ts` (how `bufferedAmount` is used), `reconnect.ts` (connect is called again on the same transport)
- `desktop/apps/pistudiodesktop/src/host/ipc.ts`
- `swe/notes/desktop-ipc-benchmark.md` (the encoding), `desktop/apps/ipc-bench/` (the page-side candidate to start from)

## What to build
- `Ipc` gains a way to make a channel, implemented in `ipc.ts` (still the only importer of `@tauri-apps/api`) and faked in tests.
- A decoder for the channel's messages in the chosen encoding, with the same vectors as the Rust codec where a batch format is used.
- `connect(url)`: `transport_open` with a new channel; resolves on the answer, rejects with an `Error` carrying the error's message. Each call makes a new handle; messages for an older handle are dropped.
- Sends carry the next `seq`. `bufferedAmount` rises by the frame's byte length at the send and falls when the send is answered. A failed send calls `onError` and does not throw.
- `onMessage` is called once per WebSocket message, in order, within the channel's callback: a string for text, an `ArrayBuffer` for binary.
- Acknowledgements: `transport_ack` every 256 KiB delivered or 50 ms, whichever comes first.
- `closed`: with an error, `onError` then `onClose(1006, "")`; else `onClose(code, reason)`. Once per connection. `isOpen` as the spec's table says.
- **Added at wave 6 (2026-11-21, from the first runner run; spec section 3 "A socket that ends while the page is behind"):** swallow an `unknown_handle` answer to `transport_ack`; report an `unknown_handle` answer to a send, after waiting up to 250 ms for `closed` to explain it; call `onClose` only when `closed` arrives, after every earlier frame reached `onMessage`; rely on no other command after the end. Test the order: frames, `closed`, a late ack rejected, a send rejected. The benchmark's `desktop/apps/ipc-bench/page/bridge.js` has a working version.

## Out of scope
- Choosing it in `createTransport` (sprint 116).
- Any change under `packages/`.

## Acceptance criteria
- [ ] With a fake channel and fake commands: connect resolves and rejects with the message; two batches of mixed frames reach `onMessage` in order with the right types, each call made before the channel callback returns.
- [ ] `bufferedAmount` follows sends and answers and is 0 when all are answered; `seq` rises by one per send from 0 and restarts on a new connect.
- [ ] Acknowledgements are sent at 256 KiB and at 50 ms (fake timers), and not when nothing was delivered.
- [ ] A `closed` with an error calls `onError` then `onClose` once; frames after it, or for an old handle, are dropped.
- [ ] A rejected send calls `onError`, and `sendBinary` does not throw.
- [ ] The app's `npm run check`, `npm run lint` and `npm test` pass.

## Test / verification plan
- `(cd desktop/apps/pistudiodesktop && npm run check && npm run lint && npm test)`

## Notes
- Hoist functions that capture nothing.
- The oxlint rule that bans network calls in this package stays on: the module makes none itself.
