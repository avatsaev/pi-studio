# Task 002 — Daemon relay transport + bootstrap wiring — Summary

- **Sprint:** sprint-032-relay-e2ee
- **Completed:** 2026-07-18
- **Status:** done

## What was implemented

### `packages/server/src/daemon/relay-transport.ts`
`connectRelay(keypair, config, events)` — dials outbound to `config.daemon.relay.endpoint`
(`ws://`/`wss://` per `useTls`), sends `{ type: "relay_register", sessionId }` on open (registration
frame format was TODO(verify) upstream; this and the fake-relay test/task-004 agree on this shape),
wraps the resulting `ws` socket as the relay package's `Transport`, and drives a
`createDaemonChannel` (from task-001) over it. On socket close, generates a **fresh** session id and
redials — architecture/relay-e2ee.md § Error Handling: "Relay restarts/drops → reconnect; new
session → new keys". `close()` tears down the current channel/socket and stops reconnecting.

### `packages/server/src/daemon/bootstrap.ts` wiring
- `resolveDaemonKeypair(home)`'s return value is now captured (`daemonKeypairB64`) and decoded to
  raw bytes for `connectRelay`.
- After the WS server starts listening: `if (config.daemon.relay.enabled) { relayHandle =
  connectRelay(...) }` — **fully opt-in**; `relay.enabled` defaults to `false`
  (`daemon-config.ts`, unchanged), so a daemon with no relay config boots and serves direct
  WebSocket clients exactly as before. Verified live (not just by inspection) — see Build & test
  results.
- Each decrypted relay app message is dispatched through the **exact same** `registry`/
  `routeTextFrame` RPC surface direct clients use, via a synthetic per-message `Session` whose
  `socket.send` re-encrypts the reply back onto the channel (`reply()` from `connectRelay`'s
  `onMessage` event) instead of writing to a real WebSocket. This means every RPC handler already
  registered for direct clients (agents, timeline, git, terminals, …) works unmodified over the
  relay path — proven live in the end-to-end smoke test.
- `getActiveSessions()` now merges direct-client sessions with a `relaySessions` set so
  manager-driven broadcasts (`agent_archived`/`agent_deleted`, etc.) also reach relay-attached
  synthetic sessions created for in-flight RPCs.
- `close()` calls `relayHandle?.close()` before tearing down the WS server / HTTP server.

## Files created / changed
| File | Change |
|------|--------|
| `packages/server/src/daemon/relay-transport.ts` | created |
| `packages/server/src/daemon/relay-transport.test.ts` | created (4 tests) |
| `packages/server/src/daemon/bootstrap.ts` | modified — relay wiring (capture keypair, `getActiveSessions` merge, `if (relay.enabled)` dial, `close()` teardown) |
| `packages/server/package.json` | added `@av-pi-studio/relay` dependency |
| `packages/server/tsconfig.json` | added `{ "path": "../relay" }` project reference |

## How it satisfies the scope
Maps to `architecture/relay-e2ee.md` § Behavior (Connection setup: outbound dial + session
registration; per-message wire format reused unmodified from task-001's channel), § TLS
(`useTls`/`PI_STUDIO_RELAY_USE_TLS` honored via `RelayConfig.useTls`; `publicUseTls` is a
client-facing-only setting, plumbed through the config type but not consumed by the daemon's own
outbound dial, which only needs `useTls`), and `architecture/daemon-bootstrap.md` § Behavior
(`connectRelay(keypair, config.daemon.relay)` called after the WS server is up; `close()` closes
the relay transport as part of graceful shutdown).

No deviations from the acceptance criteria. Client transport (task-003) and the real Cloudflare
relay server (task-004, this test uses a minimal fake standing in for it) are out of scope here as
specified.

## Build & test results
```
$ npm run build:server
> tsc -b packages/server && chmod +x packages/server/dist/daemon/main.js
(clean exit, no output)

$ npx tsc -b --force          # full workspace typecheck
(clean exit, no output)

$ npx oxlint packages/server/src/daemon/relay-transport.ts packages/server/src/daemon/relay-transport.test.ts packages/server/src/daemon/bootstrap.ts
(clean — only a pre-existing unrelated `lastAssistantText` unicorn warning, not touched by this task)

$ npx vitest run packages/server/src/daemon/relay-transport.test.ts
 ✓ packages/server/src/daemon/relay-transport.test.ts (4 tests) 294ms

$ npx vitest run          # full workspace suite — no regressions
 Test Files  72 passed (72)
      Tests  475 passed (475)
```

### Live smoke tests (beyond the unit suite)
1. **Relay disabled (default):** booted a real `startDaemon()` with no relay config, connected a
   real `ws` client, completed `hello`/`status` — confirms the direct path is untouched.
   `SMOKE PASS: direct WS connect works with relay disabled`.
2. **Relay enabled, full round trip:** booted a real `startDaemon()` with
   `daemon.relay.enabled: true` pointed at a minimal fake relay server (same shape as the
   Cloudflare adapter task-004 will build); confirmed the direct WS listener still came up
   independently; confirmed the daemon dialed out and registered a session
   (`[relay] connected, session ...`); attached a real `createClientChannel` from
   `@av-pi-studio/relay` through the fake relay, completed the actual `e2ee_hello`/`e2ee_ready`
   handshake; sent a real `list_agents_request` RPC through the encrypted channel and received a
   correctly-routed `list_agents_response` — proving the relay path reaches the daemon's real
   `HandlerRegistry`, not a stub. `SMOKE PASS: relay-enabled daemon dialed out, registered,
   completed E2EE handshake, routed a real RPC`.

## Acceptance criteria
- [x] With `relay.enabled`, the daemon dials outbound and registers a session id — verified by
      "dials outbound and registers a session id" (`relay-transport.test.ts`) and the live smoke
      test.
- [x] App messages are refused until the per-connection handshake completes — inherited directly
      from task-001's `createDaemonChannel` gating (reused unmodified); verified end-to-end by
      "refuses app messages until the e2ee handshake completes, then delivers them".
- [x] Relay drop triggers reconnect with fresh session keys — verified by "reconnects with a fresh
      session id when the relay connection drops" (drops the registered socket server-side, asserts
      a new, different session id registers).
- [x] `close()` tears down the relay transport — verified by "close() tears down the transport and
      stops reconnecting" (asserts no further registration attempts after `close()`).

## Follow-ups / TODO(verify)
- The `relay_register` frame shape (`{ type: "relay_register", sessionId }`) is this
  implementation's choice, since the real protocol is TODO(verify) upstream
  (`architecture/relay-e2ee.md` § TODO(verify) — "Relay server routing/session-id assignment
  protocol details"). Task-004's Cloudflare adapter (this same sprint) is built to match this
  frame; if the real upstream protocol differs, both sides need to change together.
- `publicEndpoint`/`publicUseTls` (the client-facing relay address, potentially different from the
  daemon's own outbound dial target) are carried in `RelayConfig` but not consumed by
  `relay-transport.ts` itself — they're informational for whatever builds the pairing URL
  (`packages/cli/src/pairing.ts`), not for the daemon's own dial.
- The daemon secret never leaves the daemon; the relay-attached synthetic `Session` never has
  access to the underlying socket, only the reply callback into the already-established encrypted
  channel.
