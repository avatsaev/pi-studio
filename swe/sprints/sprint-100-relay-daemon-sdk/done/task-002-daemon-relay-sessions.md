# Task 002 — Daemon: one `Session` per relay connection (`relay-sessions.ts`)

- **Sprint:** sprint-100-relay-daemon-sdk
- **Status:** done
- **Type:** feature
- **Area:** packages/server (daemon, ws)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
A pure-wiring module turns each `RelayConnection` into its own daemon session, created by that connection's `hello` exactly as on a direct connection, and disposes only that session when the connection closes.

## Context / why
Today bootstrap holds one `relaySession` variable and one pair of reply callbacks. Its stand-in socket has only `send`, so `bufferedAmount` is undefined (downloads unpaced) and `close()` does nothing. An invalid first frame is ignored because there is no socket to close (S8). Moving the handshake into its own module also takes about 130 lines out of `bootstrap.ts` and makes it testable with a fake connection.

## Scope references
- `swe/architecture/relay-protocol.md` § 5 (daemon protocol unchanged; invalid first frame → 1008), § Behavior — Daemon (on a text/binary record, on close)
- `swe/features/relay-multi-client.md` § Public contract 2 (one session per connection, socket facade, `daemon_status`, capability store), D8, S8
- Create: `packages/server/src/daemon/relay-sessions.ts`, `packages/server/src/daemon/relay-sessions.test.ts`
- Read for parity: `packages/server/src/daemon/bootstrap.ts` (relay block, lines ~805–948 at planning; `onSessionClose` ~784), `packages/server/src/ws/ws-server.ts` (the direct `hello` path and its 1008 close), `packages/server/src/ws/session.ts` (`bufferedAmount`, `isOpen`, `close`)

## What to build
- `attachRelaySession(conn: RelayConnection, deps): void` with `deps` injected: `registry`, `routeTextFrame`, `routeBinaryFrame` + binary handlers, `capabilityStore`, the `server_info` payload builder, `onSessionOpen(session)` / `onSessionClose(session)`, `logger`.
- First text record: must parse as a valid `hello` (`helloSchema`). Otherwise `conn.close(1008, …)` with the same reason the direct path uses. Then capabilities from `hello` or the store keyed by `clientId`; a `Session` with `transport: "relay"` and every `hello` field the direct path copies (`platform`, `agentStreams`, `appVersion`, …); reply `status`/`server_info` exactly as today's relay block (incl. `homeDir`).
- Session socket facade over the connection: `send(string | Uint8Array)` → `sendText` / `sendBinary`; `bufferedAmount` → `conn.bufferedAmount`; `readyState` OPEN while `conn.isOpen`, else CLOSED; `close(code, reason)` → `conn.close(code, reason)`.
- Binary records before `hello` are dropped. Later ones go to the same binary handlers as direct sessions.
- On `conn.onClose`: call `deps.onSessionClose(session)` (the same disposal a direct close runs) and log, once.
- Logs: `ws client connected` with `via: "relay"` and the connection id, and the matching disconnect.

## Out of scope
- Using it from bootstrap and removing the old relay block (task-003).
- Any `daemon_status` field change (none: relay sessions already report `transport: "relay"`).

## Acceptance criteria
With a fake `RelayConnection` and the real `Session`:
- [ ] A valid `hello` creates one session with `transport: "relay"` and answers `status`/`server_info`; a second text record is routed as an RPC on that session.
- [ ] A non-JSON or invalid first text record closes the connection with 1008 and creates no session.
- [ ] `session.bufferedAmount` reports the connection's value; `session.isOpen` follows `conn.isOpen`; `session.close(4000, "x")` calls `conn.close(4000, "x")`.
- [ ] Two connections produce two independent sessions; closing one runs `onSessionClose` for that session only.
- [ ] A stored capability set for a `clientId` is reused when a later `hello` omits capabilities (same as today).

## Test / verification plan
- `npx vitest run packages/server/src/daemon/relay-sessions.test.ts`
- `npm run build:server`
- `npx oxfmt <changed files>`

## Notes
- `onSessionClose` in bootstrap disposes subscriptions, daemon status, logs and file transfers. The spec also names terminal attachments: check how a direct close releases them and make sure the relay path goes through the same function. Do not add a second disposal list.
- Package docs: run alone, add the file to `packages/server/AGENTS.md`'s layout. The relay-session invariant text is rewritten in task-003.
