# Task 004 — SDK: `createRelayTransport` on protocol 2, connect limit, `RelayConnectError`

- **Sprint:** sprint-100-relay-daemon-sdk
- **Status:** done
- **Type:** feature
- **Area:** packages/client
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-099/task-001, sprint-099/task-003, sprint-099/task-005

## Goal
`createRelayTransport` connects through a protocol-2 relay, fails within 15 s with a typed reason a user can act on, and carries text and binary as on a direct socket.

## Context / why
Today `connect()` has no time limit and never settles when the daemon is offline. Binary data is base64 inside JSON. Refusals look like any other drop. D7 and D17 require an immediate, named refusal and a 15 s ceiling. The workbench already shows a failed connect's message, so the messages here reach the user with no workbench change (feature spec § Public contract 4).

## Scope references
- `swe/architecture/relay-protocol.md` § Behavior — Client, § 2 (connect 15 s), § 3 (close codes the client maps)
- `swe/features/relay-multi-client.md` § Public contract 3 (incl. the message table), § Error handling (outdated relay → `timeout`), D7, D17
- Rewrite: `packages/client/src/relay-transport.ts`, `packages/client/src/relay-transport.test.ts`
- Modify: `packages/client/src/index.ts` if needed (`RelayConnectError`, its reason type), `packages/client/AGENTS.md`, `packages/client/README.md`
- Reference: `packages/client/src/transport.ts` (`Transport`, `WsFactory`, `reasonString`, `bufferedAmount` contract)

## What to build
- Options as today (`daemonPublicKey`, `sessionId?`, `factory?`) plus `connectTimeoutMs?` (default 15 000).
- `connect(url)`: open a socket (`binaryType = "arraybuffer"`); send `relay_client_connect { v: 2, sessionId }`; wait for `relay_paired`; run `createClientChannel` over a byte adapter; resolve once `ready` opened.
- Rejects with `RelayConnectError` (`Error` subclass, `reason` field):

  | Cause | `reason` |
  |---|---|
  | close 4102 | `daemon_offline` |
  | close 4103 | `daemon_unresponsive` |
  | close 4104 | `too_many_clients` |
  | close 4105 | `daemon_outdated` |
  | `ready` box fails | `wrong_key` |
  | connect limit reached | `timeout` (the socket is closed) |
  | socket error or close before `relay_paired` with no relay code | `relay_unreachable` |
  | 4100 or any other failure | `protocol_error` |

  Each message carries the required content of the spec's message table, e.g. `daemon_offline` names both "offline" and "key replaced, link no longer valid".
- After connect: `sendText` / `sendBinary` go through the channel. `onMessage` delivers strings and `ArrayBuffer`s in wire order, synchronously. `bufferedAmount` is the socket's. A channel failure closes with 4200 `channel_error`: `onError` gets the cause, then `onClose`. A close forwarded from the daemon (e.g. 1008) reaches `onClose` with its code and reason.
- Remove the legacy channel import.

## Out of scope
- Reconnect policy (unchanged: a refusal is a failed connect, D7). The workbench (no change). The CLI (D12).

## Acceptance criteria
Tests run the real relay server and a minimal in-test protocol-2 daemon stand-in (raw control socket + data socket + `createDaemonChannel`):
- [ ] Connect resolves after `ready`; text and binary round-trip; binary arrives as `ArrayBuffer`.
- [ ] No daemon registered → rejects at once with `daemon_offline` (well under 1 s).
- [ ] Stand-in ignores `relay_dial` → rejects with `daemon_unresponsive` after the relay's (injected) attach timeout.
- [ ] 33rd client with a cap of 32 (or an injected smaller cap) → `too_many_clients`.
- [ ] Only a silent parked `relay_register` socket → `daemon_outdated`.
- [ ] Wrong daemon key → `wrong_key`; nothing was sent after `hello`.
- [ ] A raw server that accepts and never answers → `timeout` after the injected `connectTimeoutMs`.
- [ ] Unreachable port → `relay_unreachable`.
- [ ] A frame tampered by an in-test proxy after connect → `onError` then `onClose` with 4200.
- [ ] Every rejection's `message` contains the content the spec's table requires.

## Test / verification plan
- `npx vitest run packages/client/src/relay-transport.test.ts`
- `npm run build:client`
- `npx oxfmt <changed files>`

## Notes
- `@av-pi-studio/relay/server` is importable from client tests (client depends on relay; `ws` comes with it). Keep it out of client runtime code: the SDK must stay browser-safe.
- Docs: rewrite the relay sections of `packages/client/AGENTS.md` (`e2ee_bin`, "fresh ephemeral keypair" stays true) and `README.md` (options, `RelayConnectError`).
