# `@av-pi-studio/relay`

End-to-end encrypted relay for Pi-Studio. Lets a client reach a daemon that's behind a
firewall/NAT — the daemon dials **outbound** to a relay server, the client connects to the same
relay, and all application traffic between them is E2EE (Curve25519 ECDH + XSalsa20-Poly1305 NaCl
`box`) so the relay itself is **untrusted and zero-knowledge**: it can see connection metadata (IPs,
timing, sizes, session ids, and the plaintext public keys exchanged during the handshake) but never
message contents, and it cannot forge or inject commands.

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

The relay logs its full operational lifecycle with pino: every connection open (id + remote
address), session registration (session id, peer count), peer detach, and connection close (close
code, duration, bytes in/out) — plus warns on pre-registration garbage and errors on socket
failures. Frame forwarding is logged at `trace` with **sizes only**: the relay is zero-knowledge
by construction and never sees (so never logs) message contents.

| Variable | Default | Purpose |
|---|---|---|
| `PI_STUDIO_RELAY_LOG_LEVEL` | `info` | pino level (`trace`\|`debug`\|`info`\|`warn`\|`error`\|`fatal`\|`silent`) |
| `PI_STUDIO_RELAY_LOG_DIR` | _(unset)_ | Also write rotating NDJSON files here (stdout always gets logs too) |

stdout always receives logs — NDJSON in non-TTY (so `docker logs` / journald work out of the box),
pretty-printed on a TTY. `pi-studio relay start` (CLI) runs the relay detached with `stdio`
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

The same pairing link can be opened by more than one client over the daemon's lifetime (a browser
reload, a second tab, or handing the link to a different machine) — each one gets its own fresh
E2EE handshake against the daemon's single long-lived relay channel; the daemon does not require
re-pairing or lock onto whichever client connected first.

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
  RelaySessionBridge,
  createCloudflareRelayHandler,
} from "@av-pi-studio/relay";

// Node-only — pulls in `node:http` + `ws`. Never import this from browser/RN code.
import { startRelayServer } from "@av-pi-studio/relay/server";
```

| Export | Subpath | Role | Purpose |
|---|---|---|---|
| `createDaemonChannel(opts)` | `.` | daemon | E2EE channel over an abstract `Transport`; waits for the client's `e2ee_hello`, replies `e2ee_ready`; `send()`/`sendBinary()` for text/binary app traffic |
| `createClientChannel(opts)` | `.` | client | E2EE channel; generates a fresh ephemeral keypair, sends `e2ee_hello`; `send()`/`sendBinary()` for text/binary app traffic |
| `RelaySessionBridge` | `.` | relay server | Platform-agnostic verbatim frame bridge, keyed by session id — the zero-knowledge core |
| `createCloudflareRelayHandler(opts)` | `.` | relay server | Thin Cloudflare Workers `WebSocketPair` wrapper around `RelaySessionBridge` |
| `deriveRelaySessionId(publicKey)` | `.` | both | Deterministic rendezvous session id from a daemon's public key — lets a pairing link survive relay reconnects (see § Pairing note below) |
| `encodeBase64` / `decodeBase64` | `.` | both | Pure-JS base64 codec (no Node `Buffer`) — runs identically in Node and browser/RN |
| `startRelayServer(opts)` | `./server` | relay server | Self-hosted `ws`-based relay (what `pi-studio-relay`/`pi-studio relay start` run); accepts an optional `logger` |
| `createRelayLogger(opts)` | `./server` | relay server | pino operational logger: stdout always (pretty TTY / NDJSON otherwise), optional rotating file via `logDir` |

`RelaySessionBridge`'s constructor takes an optional `RelayBridgeEvents` (`onRegister`,
`onRegisterRejected`, `onForward`, `onUnregister`) — metadata-only lifecycle hooks (session ids,
peer counts, frame **sizes**, never contents) that `startRelayServer` wires to its logger; use
them for your own metrics/logging when embedding the bridge.

Both channel constructors expose an **identical** API — the daemon and client use symmetric code
paths. Neither channel accepts app messages before its handshake completes; a daemon's channel
must be given its **persistent** identity keypair (not a fresh one), since the client derives its
shared key from that same known public key before the handshake even starts.

```ts
// Minimal self-hosted relay, embedded rather than run as a separate process:
import { startRelayServer, createRelayLogger } from "@av-pi-studio/relay/server";

const handle = await startRelayServer({
  host: "0.0.0.0",
  port: 7000,
  logger: createRelayLogger({ level: "info" }), // optional; omit for silent
});
// handle.bridge is the underlying RelaySessionBridge, if you need to inspect peerCount(sessionId)
await handle.close();
```

## Wire protocol

- Registration (relay-server specific, plaintext, visible to the relay):
  `{"type":"relay_register","sessionId":"<uuid>"}` — sent as the first frame by both the daemon
  and the client; pairs sockets sharing the same session id.
- Handshake (plaintext, visible to the relay): `{"type":"e2ee_hello","ephemeralPublicKey":"<base64>"}`
  (client→daemon), `{"type":"e2ee_ready"}` (daemon→client). A daemon channel accepts a fresh
  `e2ee_hello` at any point — including after it's already completed one — re-deriving the shared
  key and replying `e2ee_ready` again; the relay imposes no cap on how many client sockets attach
  to one session id over the daemon's (long-lived, single-dial) connection.
- App traffic (text — RPC/control messages): `{"type":"e2ee_app","frame":"<base64(24-byte nonce ++ ciphertext)>"}`
  (XSalsa20-Poly1305, `nacl.box`/`nacl.box.open`). Auth failure → frame silently dropped, never
  thrown into the transport's message loop.
- App traffic (binary — terminal I/O, file-transfer chunks): `{"type":"e2ee_bin","frame":"<base64(24-byte nonce ++ ciphertext)>"}`.
  Identical crypto/framing to `e2ee_app`, just fed raw bytes instead of UTF-8 text and dispatched
  to a separate `onBinaryMessage` handler on receipt. Still travels as a JSON text WS frame — no
  raw binary WebSocket frames cross the relay, so `RelaySessionBridge`/the self-hosted relay/the
  Cloudflare adapter needed zero changes to support this.

## Security notes

- The daemon's persistent secret key never leaves the daemon process.
- The client's keypair is fresh per connection — no persistent client-side secret to steal.
- A new relay session derives fresh ECDH keys, so ciphertext from one session can never be
  replayed against another.
- Replay protection **within** a single live session is **not** implemented (random nonces, no
  sequence counter) — don't rely on it.
- The relay itself (`RelaySessionBridge`) never parses a frame past the initial registration
  check — this is enforced structurally, not by convention: nothing in its forwarding path ever
  calls `JSON.parse` on post-registration traffic.

## Performance notes (binary-over-relay)

- The relay process itself pays **zero** extra cost for binary traffic — `RelaySessionBridge`
  forwards `e2ee_bin` frames exactly like `e2ee_app`: verbatim, unparsed, byte-for-byte. All the
  cost below is paid by the two ENDPOINTS (daemon + client), never the relay.
- Wrapping binary as base64-in-JSON (rather than a raw binary WS frame) costs ~33% more wire bytes
  plus a small JSON envelope per frame. Deliberate tradeoff (see "Wire protocol" above) to avoid
  touching the relay's zero-knowledge bridging core for this.
- Terminal I/O: negligible in practice. Output is already coalesced into ~4ms batches server-side
  (`packages/server`'s `TerminalManager`) before it ever reaches the wire, and input is small,
  human-paced keystrokes — a few KB encrypted with pure-JS `nacl.box` is sub-millisecond.
- Large file transfers over relay pay proportionally more: every base64+encrypt/decrypt pass adds
  up across many large chunks. Still bounded (pure-JS `nacl.box` throughput is tens of MB/s), but
  a direct (non-relay) connection remains the faster path for bulk transfer.

## Development

```bash
npm run build       # tsc -b (also chmod +x's the pi-studio-relay binary)
npx vitest run packages/relay
```

Runtime dependencies: `tweetnacl` (crypto) and `ws` (WebSocket framing) for the channel/bridge
core, plus `pino` + `pino-pretty` + `rotating-file-stream` used only by the Node-only `./server`
subpath (operational logging). The main barrel stays free of platform-specific imports — no
framework, no HTTP client library beyond Node's own `node:http`.
