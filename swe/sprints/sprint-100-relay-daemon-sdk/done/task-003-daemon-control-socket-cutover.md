# Task 003 — Daemon: control socket with backoff and silence check; bootstrap cut over to protocol 2

- **Sprint:** sprint-100-relay-daemon-sdk
- **Status:** done
- **Type:** feature
- **Area:** packages/server (daemon)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-002

## Goal
`connectRelay` keeps one control socket registered with protocol 2 and redials it with backoff. It opens a `RelayConnection` per `relay_dial` (at most 32). The production bootstrap serves each through `attachRelaySession`. The single-session relay block is gone.

## Context / why
Today the daemon redials a closed relay socket at once, in a loop. It has no registration timeout and no dead-socket detection, and it keeps one relay session that every new client replaces (D6, D15, D17, S5, S6). This is the daemon-side cutover: after it, the daemon only speaks protocol 2.

## Scope references
- `swe/architecture/relay-protocol.md` § Behavior — Daemon (control loop), § 2 (registration answer 10 s, silence 90 s, backoff 1→30 s ±20 %, clients 32), § 3 (4107), § Error handling (outdated relay, relay restart, extra dials)
- `swe/features/relay-multi-client.md` § Public contract 2 (incl. Logs), § Error handling (self-hosted relay not updated), D15, D17, S5, S6
- Rewrite: `packages/server/src/daemon/relay-transport.ts`, `packages/server/src/daemon/relay-transport.test.ts`
- Modify: `packages/server/src/daemon/bootstrap.ts` (relay block → `connectRelay` + `attachRelaySession`; `relaySessions` set kept for `getActiveSessions`), `packages/server/src/daemon/bootstrap.test.ts` (relay section: drop the fake relay, use the real server)
- Unchanged: `RelayConfig` / `daemon.relay.*`, `deriveRelaySessionId`, `daemon-keypair.json` (D13, D14)

## What to build
- `connectRelay(keypair, config, { onConnection(conn), logger, limits?, random?, timers? }): RelayTransportHandle`. The handle keeps `sessionId` and `close()`; `close()` also closes every open data socket.
- Control loop: dial (`maxPayload` 100 MiB); send `relay_daemon_register { v: 2, sessionId }`. With no `relay_registered` within 10 s, log that the relay must be updated, close and back off. `relay_registered` resets the backoff. `relay_dial`: with 32 data sockets open, ignore it and log; otherwise `openRelayConnection` and hand the result to `onConnection`. Unknown control frames are ignored.
- Redial on close or after 90 s with no frame and no ping: wait 1, 2, 4 … 30 s with ±20 % jitter. After close code 4107 `replaced`, log that another daemon uses this key and wait 30 s.
- Data connections are independent of the control socket: a control drop leaves them open (D15).
- Bootstrap: for each connection, `attachRelaySession` with the same `onSessionClose` disposal as direct sessions; the session joins `relaySessions` while open. Delete `relaySession`, `relayReply*`, `resetRelaySession`, `onHandshake`, `onReconnect`, the "relay peer replaced" log and the legacy channel import.
- Logs: relay connected, registered, replaced, outdated relay, ignored dial, control socket closed with code and the next redial delay.

Docs: rewrite the relay parts of `packages/server/AGENTS.md` (the `send(data)` discriminating facade, single session, "relay peer replaced") and `packages/server/README.md` (relay paragraph incl. the Cloudflare mention) to the new model.

## Out of scope
- The SDK (task-004). Deleting `legacy-channel.ts` (task-005). Cross-package SDK ↔ relay ↔ daemon tests (task-006).

## Acceptance criteria
`relay-transport.test.ts` against the real relay server with short timers:
- [ ] The daemon registers and a client connect yields `onConnection` with a working connection.
- [ ] With the relay down, successive dials are spaced by the backoff (asserted on injected timers and random); `relay_registered` resets it.
- [ ] A raw socket that accepts the daemon's dial but never answers (an "outdated relay") gets one log line and a backoff redial, not a loop.
- [ ] A second registration of the same session id (raw socket) closes the daemon's control socket with 4107. The daemon waits the replaced delay before re-registering, and an open connection keeps working throughout.
- [ ] A control socket that hears nothing for the silence timeout is replaced.
- [ ] With the cap set to 2, a third `relay_dial` is ignored and logged.

`bootstrap.test.ts` (production `startDaemon`, real relay server, a raw client with `createClientChannel`):
- [ ] Two clients complete `hello`/`server_info` at once and each gets its own RPC answers; `daemon_status` lists two sessions with `transport: "relay"`.
- [ ] Closing one client disposes only its session; the other keeps working.
- [ ] An invalid first application message closes that client with 1008.
- [ ] The relay session reports a numeric `bufferedAmount` (download pacing is no longer skipped).

## Test / verification plan
- `npx vitest run packages/server/src/daemon`
- `npm run build:server`
- `npx oxfmt <changed files>`

## Notes
- The existing sprint-084/098 relay tests in `bootstrap.test.ts` (relay metadata, `agentStreams` on the relay `hello`) must keep their assertions, ported to the new harness. Do not delete coverage.
- `relayUrl` normalisation (strip a pasted scheme) stays as it is.
