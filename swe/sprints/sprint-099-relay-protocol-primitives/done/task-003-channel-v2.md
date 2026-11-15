# Task 003 — Encrypted channel v2: binary frames, counter nonces, daemon salt

- **Sprint:** sprint-099-relay-protocol-primitives
- **Status:** done
- **Type:** feature
- **Area:** packages/relay
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002

## Goal
A new `channel.ts` implements relay-protocol.md § 4: one channel per socket, binary frames only, NaCl box with a salt ‖ direction ‖ counter nonce, and the `hello` / `ready` exchange. Any failure closes the transport and delivers nothing.

## Context / why
The shipped channel uses random nonces and one shared key for both directions, and re-keys on every `e2ee_hello`. That allows reflection and replay, and lets a second client evict the first (reproduced 2026-11-15, `relay-multi-client.md` § Current state). The new channel fixes both and carries binary data as raw bytes (D1, D23). The daemon's random salt stops a replayed `hello` from making the daemon reuse a key and nonce (S1). The encrypted `ready` record proves the daemon holds its key (S2). Counters are never sent on the wire (S3).

## Scope references
- `swe/architecture/relay-protocol.md` § 4 (Encrypted channel), § Behavior — Channel (both sides), § Error handling (rows on modified/replayed/reflected frames, replayed `hello`, wrong key, text after pairing)
- `swe/features/relay-multi-client.md` § Public contract 1 (`createClientChannel`, `createDaemonChannel`)
- Create: `packages/relay/src/channel.ts`, `packages/relay/src/channel.test.ts`
- Modify: `packages/relay/src/index.ts` (export `channel.js` beside `legacy-channel.js`)
- Reference only: `packages/relay/src/legacy-channel.ts` (the shipped crypto calls), `packages/relay/src/control.ts` (`RELAY_CLOSE.channel_error`)

## What to build
- **Transport** the channel rides on. It carries bytes, not strings:
  ```ts
  interface Transport {
    send(bytes: Uint8Array): void;            // one binary WebSocket frame
    onFrame(handler: (frame: Uint8Array | string) => void): void; // a string = a text frame (a protocol error)
    onClose(handler: (code?: number, reason?: string) => void): void;
    close(code?: number, reason?: string): void;
  }
  ```
- `createDaemonChannel({ transport, daemonKeypair, events, randomBytes? })`. It waits for the `hello` frame (`0x01` ‖ 32-byte key), derives `box.before`, draws a 15-byte salt and sends `ready` (`0x01` ‖ salt ‖ box of record `0x00`, d→c counter 0). A second `hello` is a `channel_error`.
- `createClientChannel({ transport, daemonPublicKey, events, keyPair? })`. It generates a fresh key pair unless one is injected, sends `hello`, then opens the `ready` box with nonce(salt, `0x02`, 0). Failure → `channel_error`. Nothing can be sent before the box is open.
- Records: kind `0x00` ready (only as the daemon's first box), `0x01` text (UTF-8), `0x02` binary. `send(text)` and `sendBinary(bytes)`; `events.onText`, `onBinary`, `onReady`, `onClose(code, reason)`, `onError(cause)`.
- Nonce: salt (15) ‖ direction (`0x01` c→d, `0x02` d→c) ‖ counter (8 bytes, big-endian). Each side counts sent and received boxes per direction and opens each box only with the next expected counter.
- On any failure (a box that does not open, an unknown kind, `ready` not first, a malformed `hello` or `ready`, a text frame) the channel calls `onError` with the cause, then closes the transport with `4200 channel_error`. Nothing from that frame is delivered.
- The channel closes before a counter would wrap. Test it through an injectable counter start or limit, not by sending 2^64 frames.
- Seams for deterministic fixtures (task-006): `randomBytes` on the daemon side for the salt, `keyPair` on the client side.

Package docs: run alone, document `channel.ts` in `packages/relay/AGENTS.md` and `README.md` beside the legacy file. In a parallel wave, put the edits in the summary.

## Out of scope
- Relay control frames (task-001) and the relay server (task-004).
- The daemon and SDK transports that use the channel (sprint-100).
- Fixtures (task-006).

## Acceptance criteria
- [ ] Over an in-memory transport pair, a client and a daemon channel exchange text and binary messages both ways, in order, with the correct kind.
- [ ] The `hello` and `ready` frames and a message box have the byte layout of § 4; the nonce bytes are salt ‖ direction ‖ big-endian counter (asserted by opening a frame by hand with `tweetnacl`).
- [ ] Two daemon channels that receive the same `hello` send different salts.
- [ ] A modified box, a replayed box, two boxes swapped, a dropped box (the next one arrives) and a box sent back to its sender each close with `4200 channel_error` and deliver nothing.
- [ ] A client with the wrong daemon public key fails at `ready` with `channel_error`, and its `onReady` never fires.
- [ ] The daemon delivers nothing before a valid `hello`; the client sends nothing before `ready` opened (`send` throws).
- [ ] A text frame after the exchange, a second `hello`, a `ready` record after the first box and an unknown record kind each close with `channel_error`.
- [ ] A 5 MiB text message arrives intact as one frame.
- [ ] Reaching the counter limit closes the channel instead of wrapping.

## Test / verification plan
- `npx vitest run packages/relay/src/channel.test.ts packages/relay/src/legacy-channel.test.ts`
- `npm run build:relay`
- `npx oxfmt <changed files>`

## Notes
- The channel never parses the application payload. A daemon-protocol `hello` is the caller's concern (sprint-100/task-002).
- `tweetnacl` stays the only crypto dependency (D23). Use `nacl.box.before` + `nacl.box.after` / `nacl.box.open.after`.
- Rust interop (`crypto_box` 0.9.1) was run once at scope time against this layout; the fixtures in task-006 become the lasting check.
