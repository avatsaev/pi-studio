# Task 001 — Daemon: one relay data socket per client connection (`RelayConnection`)

- **Sprint:** sprint-100-relay-daemon-sdk
- **Status:** done
- **Type:** feature
- **Area:** packages/server (daemon)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-099/task-001, sprint-099/task-003, sprint-099/task-005

## Goal
Given a `connectionId` from the relay, the daemon dials a data socket, attaches it, runs the channel's daemon side and exposes the result as a `RelayConnection` that behaves like a direct socket: text, binary, queued bytes, open state and close with code.

## Context / why
D6: one daemon socket per client. Each data socket carries one encrypted channel and, later, one daemon session (task-002). Its socket is a real `ws` socket, so `bufferedAmount` is real, which is what makes download pacing work on the relay (feature spec § Public contract 2). This task is additive: a new module that nothing in bootstrap uses yet. task-003 wires it in.

## Scope references
- `swe/architecture/relay-protocol.md` § Behavior — Daemon (data socket), § 2 (key exchange 10 s, silence 90 s, frame size), § Error handling (replayed `hello`, text after pairing)
- `swe/features/relay-multi-client.md` § Public contract 2
- Create: `packages/server/src/daemon/relay-connection.ts`, `packages/server/src/daemon/relay-connection.test.ts`
- Use: `@av-pi-studio/relay` (`createDaemonChannel`, `encodeControlFrame`, `parseRelayFrame`, `RELAY_CLOSE`, `RELAY_DEFAULTS`), `@av-pi-studio/relay/server` (`startRelayServer`, tests only)
- Reference: `packages/server/src/daemon/relay-transport.ts` (`relayUrl`, `wrapSocket` — the URL helper moves or is shared; do not duplicate it)

## What to build
- `openRelayConnection({ url, sessionId, connectionId, keypair, limits?, logger }): RelayConnection` (synchronous; reports through events).
- Pinned interface (task-002 consumes it):
  ```ts
  interface RelayConnection {
    readonly connectionId: string;
    readonly bufferedAmount: number;   // the data socket's queued bytes
    readonly isOpen: boolean;          // channel ready and socket open
    sendText(text: string): void;
    sendBinary(bytes: Uint8Array): void;
    close(code?: number, reason?: string): void;
    onText(h: (text: string) => void): void;
    onBinary(h: (bytes: Uint8Array) => void): void;
    onClose(h: (code: number, reason: string) => void): void; // fires once
  }
  ```
- Flow: dial with `maxPayload` 100 MiB; send `relay_daemon_attach { v: 2, sessionId, connectionId }`; wait for `relay_paired` with that id; hand the socket to `createDaemonChannel` through a byte `Transport` adapter. No valid channel `hello` within 10 s closes the socket. No frame and no ping for 90 s closes it. `close(code, reason)` closes the WebSocket with that code, which the relay forwards to the client.
- Logs: data socket opened and closed with its connection id and close code; channel errors without payload.

## Out of scope
- Sessions, `hello` handling (task-002). The control socket and the 32-socket cap (task-003).

## Acceptance criteria
Tests run the real relay server (`@av-pi-studio/relay/server`) with short timers. The test plays the control role with a raw socket (`relay_daemon_register`, then reads `relay_dial`) and the client with a raw socket plus `createClientChannel`.
- [ ] A client's text and binary messages arrive through `onText`/`onBinary`, and `sendText`/`sendBinary` reach the client, in order.
- [ ] `bufferedAmount` is a number that rises while the client is paused.
- [ ] `close(1008, "invalid hello")` reaches the client socket as 1008 with that reason.
- [ ] A data socket whose client never sends a channel `hello` closes after the injected key-exchange timeout; `onClose` fires once.
- [ ] A client closing its socket fires `onClose` on the connection with the forwarded code.
- [ ] Attaching with an id the relay does not know ends in `onClose` with 4106.

## Test / verification plan
- `npx vitest run packages/server/src/daemon/relay-connection.test.ts`
- `npm run build:server`
- `npx oxfmt <changed files>`

## Notes
- The data socket's silence timer resets on any frame and on any ping from the relay (`ws` `"ping"` event).
- Keep the module free of `Session` and registry imports so it stays testable on its own.
- Package docs: run alone, add the file to the source layout in `packages/server/AGENTS.md`. In a parallel wave, put the edit in the summary.
