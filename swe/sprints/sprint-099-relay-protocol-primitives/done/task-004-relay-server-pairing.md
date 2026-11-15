# Task 004 — Relay server protocol 2: control sockets, pairing, refusals, parking; bridge and Cloudflare adapter deleted

- **Sprint:** sprint-099-relay-protocol-primitives
- **Status:** done
- **Type:** feature
- **Area:** packages/relay
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-002

## Goal
`startRelayServer` pairs exactly one client socket with one daemon data socket per connection, refuses with the protocol-2 close codes, parks old-protocol sockets, and forwards frames and closes between the two halves. `RelaySessionBridge` and the Cloudflare adapter are gone.

## Context / why
Today the relay forwards every frame to every other socket under a session id, so a second client's frames reach the first client and the daemon cannot tell clients apart (D6). This task implements the relay half of relay-protocol.md § Behavior — Relay except flow control, pings and shutdown, which are task-005. The Cloudflare adapter has no deployment and is deleted (D4).

## Scope references
- `swe/architecture/relay-protocol.md` § 1 (incl. Old protocol), § 2, § 3 (forwarding rule), § Behavior — Relay, § Error handling
- `swe/features/relay-multi-client.md` § Public contract 1 (Relay), § 6 (Removed), § Observability, decisions D3, D4, D6, D7, D10, D15, D16, D19, D20, S4, S7, S8, S9, S10
- Rewrite: `packages/relay/src/relay-server.ts`, `packages/relay/src/relay-server.test.ts`
- Delete: `packages/relay/src/session-bridge.ts`, `session-bridge.test.ts`, `cf-adapter.ts`, `cf-adapter.test.ts`
- Modify: `packages/relay/src/index.ts` (drop the two deleted modules)
- Use: `packages/relay/src/control.ts` (task-001), `packages/relay/src/relay-logger.ts`
- Unchanged callers to keep working: `packages/relay/src/relay-main.ts`, `packages/cli/src/relay-control.ts` (`startRelayServer({ host, port, logger })`)

## What to build
- State as in the spec: `controls` (sessionId → control socket), `waiting` (connectionId → session + client socket), `pairs`, `parked` (sessionId → old sockets with a "silent" flag).
- First-frame handling through `parseFirstFrame`:
  - invalid → `4100 protocol_error`;
  - legacy → park the socket, silent; never answer or forward;
  - `relay_daemon_register` → becomes the control socket, answered `relay_registered`; an older control socket for that id is closed `4107 replaced` while its pairs keep running;
  - `relay_client_connect` → `4102 daemon_offline` with no control socket, or `4105 daemon_outdated` when a silent parked socket is under that id (S9); `4104 too_many_clients` when waiting + paired for that id ≥ 32; otherwise mint a connection id, send `relay_dial` on the control socket and start the attach timer;
  - `relay_daemon_attach` → `4106 unknown_connection` if no matching waiting entry (wrong id, other session id, or the client left); otherwise pair and send `relay_paired { connectionId }` to both.
- The identify timer (10 s) closes `4101 identify_timeout`. The attach timer closes the waiting client `4103 daemon_unresponsive`. A client frame before `relay_paired` closes `4100`. A later frame from a parked socket clears its silent flag.
- After pairing, forward every frame unchanged, text or binary, in order, without parsing. When one half closes, close the other with the same code and reason if `isForwardableCloseCode`, else `4109 peer_closed`. That includes the workbench's `4000 stale-connection-probe`.
- Control socket close: delete `controls[S]` only if it is still the current one. Waiting entries and pairs stay (D15).
- `WebSocketServer` `maxPayload` = 100 MiB (S4); an oversize frame closes with 1009.
- Options: `host`, `port`, `logger` as today, plus an optional `limits` override of `RELAY_DEFAULTS` for tests. No new environment variable.
- Handle: replace `bridge` with read-only counts for tests (control sockets, waiting, pairs, parked). `GET /health` unchanged.
- Logs (D20, no payloads, session ids as today): control registered, replaced, closed; each refusal with its reason; each parked socket; one summary line per finished pair with connection id, session id, time to pair, bytes each way, duration, close code and reason.

Package docs: run alone, rewrite the relay server and removed-modules parts of `packages/relay/AGENTS.md` and `README.md` (layout tree, API table, the Cloudflare/"Hosted" lines). In a parallel wave, put the edits in the summary.

## Out of scope
- Flow control, pings, shutdown with 1001 (task-005).
- Comparing sent frames with fixtures (task-006).
- Daemon and client sides (sprint-100). `packages/cli` docs that mention `RelaySessionBridge` (sprint-101/task-002).

## Acceptance criteria
Tests use real `ws` sockets against the real server, with short injected timers.
- [ ] Register → `relay_registered`; client connect → the control socket gets `relay_dial` with a 32-hex `connectionId`; attach → both sides get `relay_paired` with that id.
- [ ] Two clients of one daemon are paired with two distinct data sockets; each client's text and binary frames reach only its own data socket, unchanged and in order, and the reverse.
- [ ] Each close code is sent for its condition with its name as the reason: 4100 (bad JSON, `v: 1`, bad session id, client frame before pairing), 4101, 4102, 4103, 4104 (33rd client; after one leaves, the next is accepted), 4105, 4106 (unknown id, other session's id, client already gone), 4107.
- [ ] A forwardable close on one half reaches the other with the same code and reason (incl. 1008 and 4000); an unforwardable one arrives as 4109.
- [ ] A `relay_register` socket is parked: no answer, nothing forwarded. With only a silent parked socket, a client gets `daemon_outdated`; after that socket sends a frame, the next client gets `daemon_offline`.
- [ ] After the control socket is replaced or closed, existing pairs keep forwarding; new clients get `daemon_offline` only while no control socket exists.
- [ ] A frame above the configured frame size closes with 1009 (tested with a small injected limit).
- [ ] `session-bridge.*` and `cf-adapter.*` no longer exist, and nothing imports them.
- [ ] `relay-main.ts` still starts the server and `GET /health` answers 200.

## Test / verification plan
- `npx vitest run packages/relay/src`
- `npm run build:relay && npm run build:cli` (the CLI resolves `./server`)
- `npx oxfmt <changed files>`

## Notes
- **S9 awaits the owner's confirmation** (feature spec § TODO(verify)). Keep the silent-flag rule in one place: dropping S9 must reduce to "any parked socket ⇒ `daemon_outdated`".
- The relay never reads a frame after pairing, so do not attach JSON parsing to paired sockets.
- After this task the docker relay no longer serves 0.0.120 daemons or clients. The branch's daemon and SDK move over in sprint-100. No in-repo test pairs the daemon with the real relay before then (the daemon tests use their own fake relay).
