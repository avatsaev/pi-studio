# Feature — Relay Multi-Client

> **Status: scoped (2026-11-15), not planned.** No sprint exists yet.

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [../architecture/relay-protocol.md](../architecture/relay-protocol.md) (the wire
> contract this feature implements), [../architecture/relay-e2ee.md](../architecture/relay-e2ee.md)
> (the shipped protocol, and pairing, which does not change),
> [../architecture/external-client-fixtures.md](../architecture/external-client-fixtures.md),
> [connection-resilience.md](connection-resilience.md),
> [desktop-client-protocol-followups.md](desktop-client-protocol-followups.md) (download pacing)
> Decisions: [../grills/relay-multi-client.md](../grills/relay-multi-client.md)
> Consumer brief: [../../docs/desktop-client-handoff.md](../../docs/desktop-client-handoff.md)

## Purpose

Let several clients use one daemon through the relay at the same time, and make a relay connection
behave like a direct one for large transfers.

Today a second relay client evicts the first, binary data travels as base64 inside JSON, relay
downloads are unpaced, and the relay can replay a message or send a client's own message back to
it. Pi Studio Desktop holds two connections per window, so on a relay it cannot work at all.

This feature replaces the relay's wire protocol with
[relay-protocol.md](../architecture/relay-protocol.md) in the relay, the daemon and the SDK, in one
release, with no compatibility path.

## Decisions

Taken with the project owner in the grill. They are requirements here. The brief holds the
rationale for each.

| # | Decision |
|---|---|
| D1 | Multi-client **and** transfer parity: binary frames and backpressure through the relay |
| D3 | **Hard cut.** Relay and clients speak only the new protocol. An outdated daemon is left connected and idle, and a client reaching it is told to update it |
| D4 | The Cloudflare adapter is deleted |
| D6 | One daemon socket per client, piped by the relay |
| D7 | A client asking for an offline daemon is refused at once |
| D10 | At most 32 clients per daemon on the relay |
| D11 | Fixed-key fixtures pin the contract for the Rust client |
| D12 | The CLI does not learn to connect through the relay |
| D13 | The relay keeps state in memory only; `daemon.relay.*` does not change |
| D14 | The daemon key, the pairing link and the session id do not change |
| D15 | Connected clients survive a drop of the daemon's control socket |
| D16 | A browser tab still running the old web client is left connected and idle |
| D17 | Timers, backoff, flow-control marks and refusal behaviours as listed in the protocol spec |
| D18 | Transfers are judged on correctness and bounded memory; throughput is recorded, not gated |
| D19 | No abuse limits beyond the frame cap, the identification limit and the client cap |
| D20 | The relay reports through structured logs only |
| D21 | One release, no feature flag; rollback by redeploying the previous images |
| D23 | Encryption stays NaCl box, with a message counter per direction. No Noise, no forward secrecy |

Made while scoping, where the brief left the wire details to this scope. Each is specified in
[relay-protocol.md](../architecture/relay-protocol.md):

| # | Addition | Why |
|---|---|---|
| S1 | The nonce also carries a random per-connection salt chosen by the daemon | With direction and counter alone, a relay that replays a client's key exchange makes the daemon reuse a key and nonce, which breaks the cipher |
| S2 | The daemon's acknowledgement is an encrypted record, not a plaintext frame | The client learns that the other end holds the daemon's key before it sends anything |
| S3 | The counter is not sent on the wire | Both ends count; there is nothing for the relay to alter |
| S4 | Frame-size limit of 100 MiB on the relay and on the daemon's relay sockets | Today's implicit limit, made explicit. Confirmed by the owner on 2026-11-15 |
| S5 | The daemon caps its own data sockets at 32 and drops one with no key exchange after 10 s | The relay is untrusted and decides how many sockets the daemon opens |
| S6 | After being replaced by another registration, a daemon waits 30 s before it registers again | Two daemons sharing a key would otherwise replace each other continuously |
| S7 | The relay forwards a close code and reason from one half of a connection to the other | A relay client sees the daemon's reason, as a direct client does |
| S8 | An invalid first application message closes a relay connection with `1008` | Parity with a direct connection. Today it is ignored, because the daemon has no socket to close |
| S9 | The relay tells an outdated daemon from a stale browser tab by silence: a parked socket that has sent nothing since registering counts as a daemon | Without it a client is told "update the daemon" when the daemon is only offline and an old tab is still connected. This is slightly more knowledge of the old protocol than D16 gave the relay; the tab is still left idle. **Not yet confirmed by the owner** |
| S10 | Close codes are 4100–4109 (relay) and 4200 (channel), not 4000 onward | The workbench already closes with `4000 stale-connection-probe`, and S7 forwards that code to the daemon |

## Current state (verified in code, pi-studio 0.0.120)

| Fact | Where |
|---|---|
| The relay forwards every frame to every other socket registered under the session id. Daemon and clients are not distinguished, so one client's frames also reach the others | `packages/relay/src/session-bridge.ts` |
| The daemon keeps one shared key per relay socket, replaced by every key exchange | `packages/relay/src/channel.ts` (`createDaemonChannel`) |
| The daemon keeps one relay session; a new key exchange disposes it | `packages/server/src/daemon/bootstrap.ts` (relay block) |
| The relay ignores binary frames; binary data is base64 inside a JSON text frame | `packages/relay/src/relay-server.ts`, `channel.ts` |
| A relay session's socket cannot report queued bytes, so downloads are unpaced, and cannot be closed | `packages/server/src/ws/session.ts`, `bootstrap.ts` |
| The daemon redials a closed relay socket at once, with no delay | `packages/server/src/daemon/relay-transport.ts` |
| The client's relay connect has no time limit; with the daemon offline it never settles | `packages/client/src/relay-transport.ts` |
| No WebSocket ping on either hop; no registration timeout; no frame-size setting | `relay-server.ts`, `relay-transport.ts` |
| Nonces are random; nothing detects a replayed or reordered message | `channel.ts` |

Reproduced on 2026-11-15 with a throwaway script driving the real `channel.ts` and
`session-bridge.ts`:

- **Eviction.** With client A connected, client B's key exchange replaced the daemon's key. A's
  next message failed authentication at the daemon while A still reported itself ready; A's and
  B's frames reached each other and failed there too.
- **Reflection and replay.** A client's own encrypted message, sent back to it twice, was
  delivered to the application twice as if the daemon had sent it.

Not reproduced: the two clients then taking turns evicting each other through their reconnect
loops. That part is read from the code.

## Public contract

The wire is [relay-protocol.md](../architecture/relay-protocol.md). This section says what each
package exposes and how it behaves.

### 1. Relay (`@av-pi-studio/relay`)

| Item | Contract |
|---|---|
| `startRelayServer(options)` | Speaks protocol 2: control sockets, one piped pair per client, binary and text frames forwarded unread, flow control, pings, close codes |
| Options | `host`, `port`, `logger` as today. Added, for tests: the limits and timers of relay-protocol.md § 2 |
| `GET /health` | Unchanged |
| `pi-studio-relay` binary, `PI_STUDIO_RELAY_LISTEN`, the logging variables | Unchanged. No new environment variable |
| `createClientChannel`, `createDaemonChannel` | Implement relay-protocol.md § 4 over a transport that carries bytes. A frame that fails closes the transport; `onAuthError` reports the cause first |
| `deriveRelaySessionId`, the base64 helpers | Unchanged |
| Server handle | Exposes connection counts for tests in place of today's `bridge` |

### 2. Daemon (`packages/server`)

- One control socket and one data socket per relay client, as the daemon algorithm of
  relay-protocol.md describes, including redial backoff and the silence check.
- **One daemon session per relay connection**, created by that connection's `hello`. Closing a
  connection disposes only its session: subscriptions, transfers, terminal attachments.
- A relay session reports its data socket's queued bytes and open state, and closing the session
  closes the socket. Download pacing and every other use of those two facts then work as on a
  direct connection.
- `daemon_status` lists every relay session, each with `transport: "relay"`, as it lists direct
  ones. No field is added.
- The capability store keyed by `clientId` and the absence of a password on the relay path are
  unchanged.
- Logs: relay connected, registered, replaced, each data socket opened and closed with its
  connection id, an ignored dial, an outdated relay.

### 3. SDK (`@av-pi-studio/client`)

| Item | Contract |
|---|---|
| `createRelayTransport(options)` | Same options (`daemonPublicKey`, `sessionId?`, `factory?`) plus `connectTimeoutMs?` (default 15 000) |
| `connect(url)` | Resolves once the `ready` box opened. Rejects with a `RelayConnectError` otherwise |
| `RelayConnectError` | An `Error` with `reason`: `daemon_offline`, `daemon_unresponsive`, `too_many_clients`, `daemon_outdated`, `timeout`, `wrong_key`, `relay_unreachable` or `protocol_error` |
| `sendText`, `sendBinary`, `onMessage` | Unchanged for the caller: text as strings, binary as `ArrayBuffer`, in wire order, synchronously |
| `bufferedAmount` | The relay socket's queued bytes, now ciphertext without base64 inflation |
| A channel failure after connect | The socket closes with `channel_error`; `onError` receives the cause, then `onClose` fires |

Each `reason` has a message a user can act on. Required content:

| Reason | The message says |
|---|---|
| `daemon_offline` | The daemon is not connected to the relay: it may be offline, or its key was replaced and this pairing link is no longer valid (D17) |
| `daemon_unresponsive` | The daemon did not answer through the relay |
| `too_many_clients` | The daemon already has the maximum number of relay connections |
| `daemon_outdated` | The daemon speaks an older relay protocol and must be updated (D3) |
| `timeout` | The relay did not answer in time; a self-hosted relay may need updating |
| `wrong_key` | The pairing link does not match this daemon |

### 4. Workbench and web client

No contract change. The connection store already shows a failed connect's message, so the messages
above reach the user. A refusal is a failed connect like any other: the existing retry behaviour
applies (D7).

### 5. Fixtures (D11)

A `relay/` subdirectory of `packages/protocol/fixtures/external-clients/`, with its own
`manifest.json` and `formatVersion` 1, under the same rules as the `binary/` subdirectory.

| Fixture group | Content |
|---|---|
| Keys | Fixed test keys: daemon key pair, client key pair, salt, the derived session id. Marked as test material |
| Control frames | One file per frame of relay-protocol.md § 1 |
| Close codes | The table of relay-protocol.md § 3 as data |
| Channel frames | `hello` and `ready` as bytes; a text and a binary message in each direction with their counters, as bytes and decoded |

A test in this repository rebuilds every channel fixture from the keys and compares bytes, and
opens every fixture and compares the decoded form. The relay server's tests compare the control
frames it sends with the fixtures. The relay package gains no runtime dependency on the protocol
package.

### 6. Removed

| Removed | Replacement |
|---|---|
| `relay_register` as a working registration | The three first frames of protocol 2. The relay still recognises it, to park the socket |
| `e2ee_hello`, `e2ee_ready`, `e2ee_app`, `e2ee_bin` JSON frames | The binary channel frames |
| `RelaySessionBridge`, `RelaySocket`, `RelayBridgeEvents` | The relay server's pairing; no public replacement |
| `packages/relay/src/cf-adapter.ts`, its test and its exports (D4) | None |
| The daemon's single relay session, its "relay peer replaced" path and the `onHandshake` hook | One session per data socket |

## Behavior & algorithms

All algorithms are in [relay-protocol.md](../architecture/relay-protocol.md) § Behavior. One flow
belongs here.

### What a user sees during the rollout

```
the release is merged: the hosted relay and the hosted web client switch to protocol 2

daemon not yet updated:
    it stays connected to the relay, parked
    the web client's connect fails with daemon_outdated: "update the daemon"
    direct connections to that daemon are unaffected

daemon updated and restarted:
    it registers with protocol 2
    pairing links and QR codes issued before the update work again

a browser tab still running the old web client:
    stays on "connecting" until it is reloaded
```

## Data & persistence touchpoints

None. The relay persists nothing, the daemon adds no stored data, and the daemon key file, the
pairing link and the configuration are unchanged (D13, D14).

## Observability (D20)

Structured logs only; no statistics endpoint. The relay logs, without any payload:

- one summary line per connection when it ends: connection id, session id, time to pair, bytes
  each way, duration, close code and reason;
- control-socket events: registered, replaced, closed;
- each refusal with its reason;
- each old-protocol socket it parks.

## Error handling & edge cases

Wire-level cases are in [relay-protocol.md](../architecture/relay-protocol.md) § Error handling.
The cases of the change itself:

| Condition | Expected behavior |
|---|---|
| A daemon that was not updated | Parked by the relay. Clients get `daemon_outdated`. It does not redial in a loop, because the relay never closes it (D3) |
| A browser tab that was not reloaded | Parked; shows "connecting" until reloaded (D16) |
| A self-hosted relay that was not updated, with an updated daemon | The daemon logs that the relay must be updated and retries with backoff (D17) |
| A self-hosted relay that was not updated, with an updated client | The connect fails after 15 s with `timeout` |
| A pairing link issued before the update | Works once daemon and client are both updated (D14) |
| Rollback after daemons were updated | The previous relay and web-client images are redeployed. Updated daemons cannot use the relay until downgraded. Direct connections are unaffected (D21) |
| Two clients of one daemon, one of them transferring a large file | The other keeps getting answers: each has its own socket pair (D6) |
| The desktop client's second connection | A second relay connection of the same client; it counts toward the 32 (D10) |

## Dependencies on other specs

- [../architecture/relay-protocol.md](../architecture/relay-protocol.md): the wire contract.
- [../architecture/relay-e2ee.md](../architecture/relay-e2ee.md): its wire sections are replaced;
  § Pairing stays.
- [../architecture/external-client-fixtures.md](../architecture/external-client-fixtures.md): a
  second subdirectory with its own manifest.
- [connection-resilience.md](connection-resilience.md): the connect time limit, the refusal
  reasons, the daemon's redial backoff and dead-socket detection.
- [desktop-client-protocol-followups.md](desktop-client-protocol-followups.md): "relay downloads
  are unpaced" stops being true.

## Non-goals

- Keeping the current relay protocol alive in any form (D3).
- A Cloudflare Workers relay (D4).
- Relay access from the CLI (D12).
- Forward secrecy, and replacing the key exchange with Noise (D23).
- Any change to the daemon protocol, to pairing links or to the daemon key (D14).

Deferred, offered in the grill and not chosen:

- a pairing secret separate from the daemon's key, and per-device credentials;
- a per-address socket cap and a statistics endpoint on the relay;
- a throughput pass mark for relay transfers.

## Acceptance criteria

The list the owner confirmed in the grill (D22), with the three rewordings that followed D23. Wire
conformance is in [relay-protocol.md](../architecture/relay-protocol.md) § Acceptance criteria.

- [ ] Two clients use one daemon through the relay at the same time; neither disconnects the
      other, and `daemon_status` lists two relay sessions.
- [ ] With 32 clients connected the next is refused with `too_many_clients`; after one leaves, a
      new one connects.
- [ ] A 600 MiB download and upload through a local relay finish with matching SHA-256. With the
      receiver paused, relay and daemon memory stay far below the file size. A second client keeps
      getting answers during the transfer.
- [ ] Binary data crosses the relay as binary frames; nothing is base64 inside JSON.
- [ ] The TypeScript channel reproduces the fixed-key fixtures byte for byte, in both directions.
- [ ] A modified, replayed, reordered or reflected message closes the connection and delivers
      nothing. A client with the wrong daemon key cannot connect.
- [ ] A 5 MiB JSON message arrives intact as one frame; a frame above the size limit closes the
      connection.
- [ ] Daemon offline: the client is told so at once. Daemon unresponsive: told after 10 s. No
      connect attempt lasts longer than 15 s.
- [ ] An old-protocol daemon stays connected and idle without a redial storm, and a client asking
      for it is told the daemon must be updated.
- [ ] With the relay down, the daemon's redials are spaced by backoff. A silent control socket is
      replaced within 90 s. Connected clients survive a control-socket drop.
- [ ] A pairing link issued before the update works once both sides are updated.
- [ ] Fixed-key fixtures exist and the TypeScript code is tested against them. The Cloudflare
      adapter is gone, and the relay documents are rewritten.
- [ ] Live check on the compose stack (`docker/docker-compose.yml`): two browser tabs through the
      relay at once, with a terminal and a file transfer.

Documents, updated in the same change:

- [ ] `swe/architecture/relay-e2ee.md` keeps pairing and identity and points to
      `relay-protocol.md` for the wire; its "planned change" banner is removed.
- [ ] `swe/MAIN-SCOPE.md` (technology table, the relay rows, the open question on replay
      protection), `swe/architecture/external-client-fixtures.md`,
      `swe/features/connection-resilience.md`,
      `swe/features/desktop-client-protocol-followups.md`.
- [ ] `AGENTS.md` (root), `README.md`, `CONTRIBUTING.md`, `packages/relay/AGENTS.md` and
      `README.md`, `packages/client/AGENTS.md`, `packages/server/AGENTS.md` and `README.md`,
      `packages/cli/AGENTS.md`, `docker/README.md`, the fixtures `README.md` and `CHANGELOG.md`.
- [ ] `docs/desktop-client-handoff.md`: the relay section, the answered open question on a second
      channel, the Rust library and the fixtures a Rust client tests against.

## TODO(verify)

- **Frame-size limit (S4).** 100 MiB, confirmed by the owner on 2026-11-15. It rests on no
  measurement; see relay-protocol.md § TODO(verify).
- **The three reworded acceptance criteria** (fixtures byte for byte; 5 MiB as one frame; the
  Cloudflare adapter gone, without `tweetnacl`) were put to the owner after D23. The owner asked
  for this scope without objecting; that is taken as acceptance, not as an explicit confirmation.
- **S9** (telling an old daemon from a stale tab by silence) goes slightly beyond D16 and awaits
  the owner's confirmation. Dropping it means every parked socket counts as an outdated daemon.
- **Eviction loop.** Reproduced only up to the eviction itself (see Current state).
- **Hosted relay addresses.** Whether the hosted relay sees real client addresses or only its
  reverse proxy's was not checked. It matters only if a per-address limit is added later. Owner:
  engineer.
- **Relay throughput.** Not measured. The live check records it next to the direct-connection
  figures of sprints 096 and 097 (D18).
- **Old daemons and pings.** That a parked 0.0.120 daemon answers the relay's pings, and so is not
  closed and does not redial, is read from its socket library's behaviour, not run.
