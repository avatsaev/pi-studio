# `@av-pi-studio/relay`

Multi-client end-to-end encrypted relay (protocol 2) for Pi-Studio. Lets clients reach a daemon
that's behind a firewall/NAT — the daemon dials **outbound** to a relay server, each client connects
to the same relay and is paired with its own daemon socket, and all application traffic between
them is E2EE (Curve25519 NaCl `box`, XSalsa20-Poly1305) so the relay itself is **untrusted and
zero-knowledge**: it can see connection metadata (IPs, timing, sizes, session ids, and the public
keys exchanged during the handshake) but never message contents, and it cannot forge, replay or
inject commands without the connection closing.

---

## Install

```bash
npm install @av-pi-studio/relay
```

## Run a relay server

The package ships a standalone, runnable relay — no daemon/client code needed to stand one up.

```bash
# via npx, no install
npx @av-pi-studio/relay --listen 0.0.0.0:7000

# or after a global/local install
pi-studio-relay --listen 0.0.0.0:7000

# or via env var instead of --listen
PI_STUDIO_RELAY_LISTEN=0.0.0.0:7000 pi-studio-relay
```

Defaults to `0.0.0.0:7000` if neither `--listen` nor `PI_STUDIO_RELAY_LISTEN` is set. Exposes:
- A WebSocket endpoint (root path) — where daemons and clients connect.
- `GET /health` → `200 ok` — liveness probe.

### Logging

The relay logs its operational lifecycle with pino: control sockets registered, replaced and
closed; every refusal with its close reason; every parked old-protocol socket; and one summary
line per finished pair (connection id, session id, time to pair, bytes each way, duration, close
code and reason). Connection open/close and pairing are `debug`. Logs carry **metadata only**:
the relay is zero-knowledge by construction and never sees (so never logs) message contents.

| Variable | Default | Purpose |
|---|---|---|
| `PI_STUDIO_RELAY_LOG_LEVEL` | `info` | pino level (`trace`\|`debug`\|`info`\|`warn`\|`error`\|`fatal`\|`silent`) |
| `PI_STUDIO_RELAY_LOG_DIR` | _(unset)_ | Also write rotating NDJSON files here (stdout always gets logs too) |

stdout always receives logs — NDJSON in non-TTY (so `docker logs` / journald work out of the box),
pretty-printed on a TTY. The first line logged is always the package version
(`pi-studio relay v<version> starting`), so `docker logs`/journald output immediately identifies
which build is running. `pi-studio relay start` (CLI) runs the relay detached with `stdio`
ignored, so it configures a rotating file under `$PI_STUDIO_HOME/logs/` instead.

Shuts down cleanly on `SIGINT`/`SIGTERM`.

### From the Pi-Studio CLI

`@av-pi-studio/cli` manages a local relay as its own long-lived process, the same way it manages a
local daemon:

```bash
pi-studio relay start --listen 0.0.0.0:7000   # spawn, wait for health
pi-studio relay status --listen 0.0.0.0:7000  # up/down
pi-studio relay stop                          # SIGTERM the recorded pid
```

### Pointing a daemon at a relay

On the daemon side (`@av-pi-studio/server`), set `daemon.relay` in `config.json` (or the matching
env vars) to dial out to the relay you started above:

```jsonc
{
  "daemon": {
    "relay": {
      "enabled": true,
      "endpoint": "relay-host:7000",
      "useTls": false
    }
  }
}
```

Env equivalents: `PI_STUDIO_RELAY_ENABLED`, `PI_STUDIO_RELAY_ENDPOINT`, `PI_STUDIO_RELAY_USE_TLS`,
`PI_STUDIO_RELAY_PUBLIC_ENDPOINT`, `PI_STUDIO_RELAY_PUBLIC_USE_TLS`. With `relay.enabled` unset
(the default, `false`), the daemon behaves exactly as if this package didn't exist — the relay is
fully opt-in and never affects direct WebSocket connections.

### Pairing a browser client through the relay

Once the daemon dials the relay (above), `pi-studio daemon pair` prints a pairing link that
carries the relay's client-facing endpoint (`daemon.relay.publicEndpoint`/`publicUseTls`, falling
back to `endpoint`/`useTls`) instead of a direct host — see `@av-pi-studio/cli`'s
`buildPairingUrl`. A browser (`@av-pi-studio/web-client`) or any `@av-pi-studio/client` consumer
opening that link connects via `createRelayTransport`, deriving the SAME rendezvous session id
(`deriveRelaySessionId(daemonPublicKey)`) the daemon registered under — no session id needs to be
transmitted separately, and the link keeps working across relay reconnects (the daemon always
re-registers under this deterministic id, never a fresh random one per connection).

The same pairing link can be opened by up to 32 clients at once (browser tabs, other machines) —
each gets its own data socket, its own encrypted channel and its own daemon session, so one client
never sees another's traffic and one closing does not disturb the rest. No re-pairing is needed.

## Library API

For embedding directly (custom relay deployments, tests, or building the daemon/client transports
this package's own consumers use). The main entry is deliberately **browser/RN-safe** (only pure
crypto + logic, no platform-specific runtime imports); `startRelayServer` is Node-only (`node:http`,
`ws`) and lives behind a separate subpath so it's never pulled into a browser bundle:

```ts
// Browser/RN/Node — pure crypto + logic, no platform-specific imports.
import {
  createDaemonChannel,
  createClientChannel,
} from "@av-pi-studio/relay";

// Node-only — pulls in `node:http` + `ws`. Never import this from browser/RN code.
import { startRelayServer } from "@av-pi-studio/relay/server";
```

| Export | Subpath | Role | Purpose |
|---|---|---|---|
| `createDaemonChannel(opts)` | `.` | daemon | Protocol-2 encrypted channel over a byte `Transport`: waits for the client's `hello`, answers an encrypted `ready` carrying a random salt; `send()`/`sendBinary()`; any failure closes with 4200 `channel_error` |
| `createClientChannel(opts)` | `.` | client | Protocol-2 channel; generates a fresh ephemeral keypair, sends `hello`, opens the daemon's `ready`; `send()`/`sendBinary()`; nonces are salt ‖ direction ‖ counter, binary frames only |
| `deriveRelaySessionId(publicKey)` | `.` | both | Deterministic rendezvous session id from a daemon's public key — lets a pairing link survive relay reconnects (see § Pairing note below) |
| `encodeControlFrame`, `parseFirstFrame`, `parseRelayFrame`, `RELAY_CLOSE`, `isForwardableCloseCode`, `RELAY_DEFAULTS`, `newConnectionId` | `.` | all | Protocol-2 control frames, close codes, limits and timers (pure, browser-safe) |
| `encodeBase64` / `decodeBase64` | `.` | both | Pure-JS base64 codec (no Node `Buffer`) — runs identically in Node and browser/RN |
| `startRelayServer(opts)` | `./server` | relay server | Self-hosted `ws`-based relay (what `pi-studio-relay`/`pi-studio relay start` run); accepts an optional `logger` and `limits`; returns `{ host, port, counts(), flow(), close() }` |
| `createRelayLogger(opts)` | `./server` | relay server | pino operational logger: stdout always (pretty TTY / NDJSON otherwise), optional rotating file via `logDir` |

`startRelayServer` also takes an optional `limits` (a partial override of `RELAY_DEFAULTS`: client
cap, frame size, identify/attach timers, ping interval, flow-control marks) — meant for tests.

Both channel constructors take a byte `Transport` and a `ChannelEvents` handler — the daemon and
client use symmetric code paths. Neither channel sends app messages before its handshake completes;
a daemon's channel must be given its **persistent** identity keypair (not a fresh one), since the
client derives its shared key from that same known public key before the handshake even starts.

```ts
// Minimal relay, embedded rather than run as a separate process:
import { startRelayServer, createRelayLogger } from "@av-pi-studio/relay/server";

const handle = await startRelayServer({
  host: "0.0.0.0",
  port: 7000,
  logger: createRelayLogger({ level: "info" }), // optional; omit for silent
});
// handle.counts() → { controls, waiting, pairs, parked } (read-only, for tests/metrics)
await handle.close();
```

## Wire protocol

- Relay control protocol 2 (plaintext, visible to the relay; architecture/relay-protocol.md):
  every socket's first frame is `relay_daemon_register { v: 2, sessionId }` (daemon control
  socket, answered `relay_registered`), `relay_client_connect { v: 2, sessionId }` (client) or
  `relay_daemon_attach { v: 2, sessionId, connectionId }` (daemon data socket). The relay sends
  `relay_dial { connectionId }` on the control socket for each client, pairs the client with the
  data socket that attaches, sends `relay_paired { connectionId }` to both, then forwards every
  frame between them unread. Refusals are WebSocket closes with codes 4100–4109 (reason = name);
  a close on one half is forwarded to the other (`4109 peer_closed` when the code cannot be).
- Legacy registration (protocol 1, 0.0.120 and earlier):
  `{"type":"relay_register","sessionId":"<uuid>"}`. The relay parks such a socket — open, silent,
  never forwarded — and a client asking for a daemon that only has a silent parked socket is
  closed `4105 daemon_outdated`.
- Encrypted channel (after `relay_paired`, **binary frames only**): the client sends `hello`
  (`0x01` ‖ its fresh public key); the daemon answers `ready` (`0x01` ‖ 15-byte salt ‖ NaCl box of
  a `ready` record). Every later frame is a bare box of one record (kind byte `0x01` text /
  `0x02` binary, then payload), nonce = salt ‖ direction ‖ 8-byte counter. A text frame, or a frame
  that fails to open, closes the connection with `4200 channel_error`. Each client connection has
  its own data socket, channel and daemon session (up to 32 per daemon).

## Security notes

- The daemon's persistent secret key never leaves the daemon process.
- The client's keypair is fresh per connection — no persistent client-side secret to steal.
- Nonces are daemon salt (random per connection, sent in clear in `ready`) ‖ direction ‖ a counter
  that is never on the wire. The salt keeps nonces distinct even if a relay replays a recorded
  client `hello`; counters make a replayed, dropped, reordered or reflected frame fail to open,
  which closes the connection with `4200 channel_error`. Nothing from the failing frame is
  delivered.
- The relay itself never parses a frame once a pair is formed (`relay_paired`) — this is enforced
  structurally, not by convention: nothing in its forwarding path ever calls `JSON.parse` on
  paired traffic.

## Performance notes

- The relay process pays no per-frame cost for any traffic kind: it forwards every paired frame
  verbatim, unparsed, byte-for-byte, and does not know text from binary (both are boxes). The
  channel cost (one `nacl.box` pass per frame, 17 bytes of overhead: kind byte + Poly1305 tag) is
  paid by the two endpoints.
- Backpressure: the relay stops reading from a sender whose peer has more than 1 MiB queued and
  resumes at or below 256 KiB (per direction of each pair), so the daemon's download pacing (real
  `bufferedAmount`) works through the relay and a slow client cannot grow the relay's memory
  without bound.
- Measured on loopback only (600 MiB file, 2026-11-15): download 4.2 s (~143 MiB/s), upload 4.4 s
  (~138 MiB/s). With one client socket paused for 30 s, the daemon's RSS grew by 51.6 MiB and the
  relay stayed at ~123 MiB, while a second client kept getting answers (p50 0.84 ms, max 9.75 ms).
  Real networks will be slower; these figures say nothing about them.

## Development

```bash
npm run build       # tsc -b (also chmod +x's the pi-studio-relay binary)
npx vitest run packages/relay
```

Runtime dependencies: `tweetnacl` (crypto) and `ws` (WebSocket framing) for the channel/bridge
core, plus `pino` + `pino-pretty` + `rotating-file-stream` used only by the Node-only `./server`
subpath (operational logging). The main barrel stays free of platform-specific imports — no
framework, no HTTP client library beyond Node's own `node:http`.
