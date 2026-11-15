# `@av-pi-studio/relay` — AGENTS.md

Relay protocol 2: the encrypted channel primitives, plus a standalone runnable relay server. Lets
several clients reach a daemon behind a firewall/NAT without opening inbound ports, while the relay
itself stays zero-knowledge (see `swe/architecture/relay-protocol.md`; pairing and identity in
`swe/architecture/relay-e2ee.md`). Published to npm as
`@av-pi-studio/relay`; ships both as a library and as a `pi-studio-relay` CLI binary.

---

## Purpose

Provides the encrypted **channel** abstraction shared by the daemon (outbound relay dial,
`packages/server`'s `relay-transport.ts`) and the client (relay transport, `packages/client`'s
`relay-transport.ts`). Both sides construct a channel over an abstract `Transport` (any send/receive
text-frame link) and get an identical API: `createDaemonChannel` / `createClientChannel`.

Also ships a runnable relay: `relay-server.ts`/`relay-main.ts` — a plain Node process speaking
relay protocol 2 (pairs one client socket with one daemon data socket per connection), runnable
directly (`npx @av-pi-studio/relay`), managed by `packages/cli`'s `pi-studio relay start|stop|status`,
or containerized via `docker/relay.Dockerfile` (tiny stateless image; see `docker/README.md`).

The relay only ever forwards frames produced by the endpoints — it never has the keys to read or
forge them.

---

## Source layout

```
src/
  index.ts             Re-exports channel.ts, base64.ts, session-id.ts, control.ts.
                        Deliberately does NOT re-export relay-server.ts /
                        relay-logger.ts (Node-only: node:http, ws, node:fs) — see "./server"
                        subpath export below.
  channel.ts           Protocol-2 channel (relay-protocol.md § 4): createClientChannel(),
                        createDaemonChannel(), Transport (byte frames), ChannelEvents, Channel.
                        Binary frames only; NaCl box with salt ‖ direction ‖ counter nonce;
                        hello / encrypted ready exchange; any failure → close 4200 channel_error.
                        Seams: randomBytes (daemon salt), keyPair (client), counterStart/counterLimit.
  channel.test.ts
  base64.ts             Pure-JS base64 codec (no Node Buffer — runs in browser/RN too).
  base64.test.ts
  session-id.ts         deriveRelaySessionId(publicKey) — deterministic rendezvous session id
                        derived from a daemon's persistent Curve25519 public key (SHA-512 of the
                        key, truncated to 16 bytes / 32 hex chars). Lets a pairing link stay valid
                        across relay reconnects: the daemon's own outbound dial
                        (`packages/server/src/daemon/relay-transport.ts`) and the client's relay
                        transport (`packages/client/src/relay-transport.ts`, when no `sessionId` is
                        passed explicitly) both compute the SAME id from the SAME public key,
                        instead of negotiating a fresh random id per connection that a
                        previously-printed pairing link couldn't reference. Adds no new secret —
                        the public key is already the pairing link's trust anchor.
  session-id.test.ts
  control.ts            Protocol-2 control vocabulary, pure/browser-safe: frame types,
                        encodeControlFrame, parseFirstFrame (never throws), parseRelayFrame,
                        isValidSessionId/isValidConnectionId, RELAY_CLOSE (4100–4109, 4200),
                        isForwardableCloseCode, RELAY_DEFAULTS (limits/timers), newConnectionId.
  control.test.ts
  relay-server.ts       startRelayServer() — standalone, runnable relay for protocol 2: a plain Node
                        `http`+`ws` WebSocket server (control sockets, pairing, refusals, parking of
                        old-protocol sockets, frame/close forwarding), plus a bare `GET /health`
                        (200 `ok`) liveness endpoint. Node-only (imports
                        `node:http`, `ws`) — exposed via the `"./server"` package export subpath,
                        NOT the main barrel, so it never drags `node:http` into a browser bundle
                        that transitively imports this package (e.g. web-client, via
                        `@av-pi-studio/client`'s relay transport).
  relay-server.test.ts  Real `ws` sockets against the real server, short injected timers and small
                        flow-control marks (a stopped reader proves pause/resume and the queue bound).
  relay-logger.ts       createRelayLogger() — pino operational logger for the self-hosted relay.
                        stdout ALWAYS (pretty on a TTY, NDJSON otherwise, so `docker logs` works),
                        plus an optional rotating NDJSON file via `logDir` /
                        `PI_STUDIO_RELAY_LOG_DIR`. Node-only — imported only from
                        relay-server.ts/relay-main.ts (the `"./server"` subpath), never the main
                        barrel; relay-server.ts re-exports it so embedders spawning the server
                        inline (packages/cli's relay-control.ts) can build one from the same
                        resolved module URL.
  relay-logger.test.ts
  relay-main.ts          Process entry (`bin: pi-studio-relay`). Reads `--listen host:port` /
                        `PI_STUDIO_RELAY_LISTEN` (default `0.0.0.0:7000`), builds the stdout
                        logger (`PI_STUDIO_RELAY_LOG_LEVEL`, default `info`), logs its own
                        package.json version as the FIRST line (read via `createRequire` against
                        `../package.json` — works from both `src/` and compiled `dist/`, one
                        level below the package root either way), calls startRelayServer(),
                        shuts down cleanly on SIGINT/SIGTERM. This is what `npx @av-pi-studio/relay`
                        runs directly and what `pi-studio relay start` (packages/cli's
                        relay-control.ts) spawns as a detached child process (with a file logger
                        under `$PI_STUDIO_HOME/logs/`, since stdio is ignored).
```

---

## Public API (`src/channel.ts`)

### `createDaemonChannel(opts): Channel`
```ts
interface DaemonChannelOptions {
  transport: Transport;
  /** The daemon's PERSISTENT keypair (`daemon-keypair.json`) — not per-connection ephemeral. */
  daemonKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };
  events: ChannelEvents;
  randomBytes?: (length: number) => Uint8Array;  // salt source (test seam)
  counterStart?: bigint; counterLimit?: bigint;  // test seams (default 0n / 2^64)
}
```
One channel per data socket. The first frame must be a binary `hello` (`0x01` ‖ client public
key); the channel derives `sharedKey = box.before(clientPublic, daemonSecret)`, draws a fresh
15-byte salt, sends `ready` and fires `onReady`. There is no re-hello: a new client is a new
socket and so a new channel (the relay pairs one client socket with one data socket).

### `createClientChannel(opts): Channel`
```ts
interface ClientChannelOptions {
  transport: Transport;
  /** The daemon's persistent public key, obtained via the pairing offer (URL fragment). */
  daemonPublicKey: Uint8Array;
  events: ChannelEvents;
  keyPair?: { publicKey: Uint8Array; secretKey: Uint8Array };  // default: fresh nacl.box.keyPair()
  counterStart?: bigint; counterLimit?: bigint;
}
```
Uses a FRESH ephemeral keypair, derives the shared key at once (it knows the daemon's public key),
sends `hello` from its constructor, and opens only once the `ready` box has opened (proof the other
end holds the daemon secret). It sends nothing before that.

### `Channel`, `ChannelEvents`, `Transport`
```ts
interface Channel {
  send(text: string): void;             // text record — throws before open or after close
  sendBinary(bytes: Uint8Array): void;  // binary record (terminal I/O, file-transfer chunks)
  close(code?: number, reason?: string): void;  // default 1000
}
interface ChannelEvents {
  onText(text: string): void;
  onBinary(bytes: Uint8Array): void;
  onReady?(): void;   // daemon: hello accepted + ready sent; client: ready box opened
  onClose?(code?: number, reason?: string): void;
  onError?(cause: Error): void;  // any channel failure; the channel then closes 4200 itself
}
interface Transport {  // caller-supplied binary-frame socket
  send(bytes: Uint8Array): void;
  onFrame(handler: (frame: Uint8Array | string) => void): void;  // a string = text frame = protocol error
  onClose(handler: (code?: number, reason?: string) => void): void;
  close(code?: number, reason?: string): void;
}
```
Also exported: `CHANNEL_VERSION`, `CHANNEL_SALT_LENGTH`, `RECORD_KIND`, `CHANNEL_DIRECTION`,
`channelNonce(salt, direction, counter)`.

### `deriveRelaySessionId(publicKey: Uint8Array): string` (`session-id.ts`)
SHA-512 of the public key, truncated to the first 16 bytes (32 lowercase hex chars). Pure function,
deterministic — same key always yields the same id, distinct keys always yield distinct ids (see
"Source layout" above for why this exists). Used as the default `sessionId` on both sides of a
relay-routed pairing: the daemon's outbound dial and the client's relay transport when no
`sessionId` is passed explicitly.

### Control protocol 2 (`control.ts`)
Shared by relay server, daemon and SDK (architecture/relay-protocol.md §§ 1–3). `encodeControlFrame(frame)`;
`parseFirstFrame(data)` → `daemon_register | client_connect | daemon_attach | legacy | invalid` (never
throws); `parseRelayFrame(data)` → `relay_registered | relay_dial | relay_paired | null`;
`isValidSessionId` / `isValidConnectionId` (32 lowercase hex); `RELAY_CLOSE` (`{code, reason}` per
name); `isForwardableCloseCode(code)`; `RELAY_DEFAULTS` (limits and timers); `newConnectionId(randomBytes?)`
(tweetnacl default).

---

## Removed modules

The old session-bridge and Cloudflare-adapter modules are deleted:
the bridge forwarded every frame to every other
socket under a session id (a second client saw the first one's traffic, and the daemon could not
tell clients apart), and the Cloudflare adapter had no deployment. `relay-server.ts` is the only
relay implementation.

## Public API (`src/relay-server.ts`, `src/relay-main.ts`)

```ts
function startRelayServer(opts: {
  host?: string;  // default "0.0.0.0" — unlike the daemon, the relay must accept remote dials
  port: number;
  logger?: RelayLogger;  // default: silent (tests/embedded); relay-main.ts passes a real stdout logger
  limits?: Partial<RelayLimits>;  // overrides of RELAY_DEFAULTS (tests: short timers, small frame size)
}): Promise<{
  host: string; port: number;
  counts(): { controls: number; waiting: number; pairs: number; parked: number }; // read-only, tests
  flow(): { pausedDirections: number; peakQueuedBytes: number }; // read-only, tests
  close(): Promise<void>;
}>;
```
A plain Node `http` server exposing `GET /health` (200 `ok`) plus a `ws.WebSocketServer`
(`maxPayload` = `limits.maxFrameBytes`, 100 MiB by default; an oversize frame closes 1009) that
implements relay protocol 2 (architecture/relay-protocol.md § Behavior — Relay). State: `controls`
(session id → control socket), `waiting` (connection id → client socket), `pairs`, `parked`
(session id → old-protocol sockets with a silent flag), and a per-session count of waiting + paired
connections (the 32-client cap, D10). The first frame of every socket goes through
`parseFirstFrame`:

- invalid (bad JSON, binary, `v` ≠ 2, bad ids, unknown type) → `4100 protocol_error`; no first
  frame within `identifyTimeoutMs` (10 s) → `4101`;
- `relay_register` (protocol 1) → the socket is **parked**: kept open, never answered, never
  forwarded, its later frames ignored except that the first one clears its silent flag. The
  silent-flag rule lives in one function (`looksLikeOutdatedDaemon`), so dropping S9 reduces to
  "any parked socket ⇒ `daemon_outdated`";
- `relay_daemon_register` → the control socket, answered `relay_registered`; an older control
  socket for the same id is closed `4107 replaced` while its pairs keep running;
- `relay_client_connect` → `4102 daemon_offline` without a control socket (`4105
  daemon_outdated` instead when a silent parked socket is under that id), `4104
  too_many_clients` at 32 waiting + paired, otherwise a 32-hex `connectionId` is minted,
  `relay_dial` goes to the control socket and the attach timer (`attachTimeoutMs`, 10 s; on
  expiry `4103 daemon_unresponsive`) starts. A client frame before `relay_paired` → `4100`;
- `relay_daemon_attach` → `4106 unknown_connection` unless a waiting entry has that id **and** that
  session id; otherwise the pair forms and both sockets get `relay_paired { connectionId }`.

After pairing, every frame is forwarded unchanged and in order (`ws.send(data, { binary })`),
never parsed. When one half closes, the other is closed with the same code and reason if
`isForwardableCloseCode` (incl. 1008 and the workbench's `4000 stale-connection-probe`), else `4109
peer_closed`; a socket that ends abnormally (1006) or without a status (1005) is therefore seen as
`4109` by its peer. A control socket's close deletes `controls[S]` only if it is still the current
one; waiting entries and pairs stay (D15).

With a logger injected, the server logs (metadata only): `control socket registered` / `replaced`
/ `closed`, every refusal (`refused: <detail>`, with code and reason), every `parked old-protocol
socket`, and one `pair closed` line per finished pair (connection id, session id, `timeToPairMs`,
`bytesToDaemon`/`bytesToClient`, `durationMs`, `closedBy`, `code`, `reason`). Connection open/close
and pairing are `debug`; socket errors are `error`.

**Flow control** (per direction of each pair, D17): after each forward, if the receiver's
`bufferedAmount` is above `flowHighWaterBytes` (1 MiB) the relay `ws.pause()`s the *sender* (TCP
backpressure then reaches the daemon, whose download pacing works through the relay); a 10 ms poll
resumes it once the receiver is at or below `flowLowWaterBytes` (256 KiB) or no longer open. The two
directions of a pair, and different pairs, are independent. The queue can overshoot the high mark by
the frames already read in the chunk that crossed it. `endPair` and `close()` resume paused senders
first (a paused socket cannot read its peer's close reply).

**Pings** (D17): every `pingIntervalMs` (30 s) the relay pings every socket — control, waiting,
paired and parked ones alike (D3: an old daemon answers pings and is never closed). A `pong`
resets the socket's unanswered count; a socket with two unanswered pings at the next tick is closed
`4108 ping_timeout`, its tables are cleaned up at once (a dead peer never completes the close
handshake), and its pair partner is closed with the same code. A socket whose reads flow control
has paused cannot answer and is not counted. A receiver draining slower than 1 MiB per two ping
intervals can therefore be timed out.

**Shutdown**: `close()` stops the ping timer, sends `1001 going away` to every open socket, waits
up to 2 s for them to close, terminates the rest, then closes the HTTP server.

`relay-main.ts` is the CLI-facing process entry (`bin: pi-studio-relay`): parses `--listen host:port`
/ `PI_STUDIO_RELAY_LISTEN` (default `0.0.0.0:7000`), builds the operational logger
(`createRelayLogger()` — stdout always, `PI_STUDIO_RELAY_LOG_LEVEL` default `info`,
`PI_STUDIO_RELAY_LOG_DIR` for an additional rotating file), logs its `package.json` version as the
first line (`pi-studio relay v<version> starting`), calls `startRelayServer`, logs the
bound address, and closes cleanly on `SIGINT`/`SIGTERM`. `packages/cli`'s `relay-control.ts`
resolves `startRelayServer` via `import.meta.resolve("@av-pi-studio/relay/server")` (the subpath
export, not the main barrel) to spawn/manage it as a supervised subprocess for `pi-studio relay
start|stop|status` — passing `createRelayLogger({ logDir: "$PI_STUDIO_HOME/logs" })` since the
detached child's stdio is ignored.

---

## Wire format

Authoritative spec: `swe/architecture/relay-protocol.md`. In short:

- **Control frames** (JSON text, plaintext, only as the first frames of a socket): `relay_daemon_register`,
  `relay_registered`, `relay_client_connect`, `relay_dial`, `relay_daemon_attach`, `relay_paired`
  (`control.ts`). After `relay_paired` every frame is binary.
- **`hello`** (client → daemon): `0x01` ‖ client public key (32). **`ready`** (daemon → client):
  `0x01` ‖ salt (15) ‖ box of a `ready` record (daemon-to-client counter 0). Every later frame is a
  bare box of a record: one kind byte (`0x01` text = UTF-8, `0x02` binary) plus payload.
- Nonce = salt (15) ‖ direction (`0x01` client→daemon, `0x02` daemon→client) ‖ counter (8, big-endian),
  starting at 0 per direction. `box = nacl.box.after(record, nonce, sharedKey)` (XSalsa20-Poly1305).
- A text frame after pairing, a short or unopenable box, an unknown record kind, or a `ready`
  record anywhere but first → `onError` and close 4200 `channel_error`; nothing from the frame is
  delivered.

---

## Invariants

- **The daemon's persistent secret never leaves the daemon.** `createDaemonChannel` takes the
  identity keypair directly — do not generate a throwaway keypair for it, or the client (which
  derives its shared key from the daemon's known public key before the handshake even starts) will
  never be able to compute a matching key.
- **The client's keypair is always fresh per channel** (no persistent client-side secret to steal).
- **Nonce uniqueness**: the nonce is daemon salt (15 random bytes, drawn per connection, sent in
  clear in `ready`) ‖ direction ‖ 64-bit counter that is never on the wire. A relay replaying a
  recorded client `hello` makes the daemon derive the same key but a new salt, so no key+nonce pair
  is ever reused. A box that does not open at the expected counter (replay, reorder, reflection,
  tamper) closes the channel with 4200 `channel_error`. A side closes before a counter would wrap.
- **No Node-only APIs** in the main-barrel modules (`base64.ts`; `channel.ts` uses
  `TextEncoder`/`TextDecoder`, also available in browsers/RN) — everything `index.ts` re-exports
  must run identically in the daemon and in a browser/RN client transport. Node-only code
  (`relay-server.ts`, `relay-logger.ts`) lives behind the `"./server"` subpath.
- **Relay logs are metadata-only.** Logging in `relay-server.ts` may record connection ids,
  remote addresses, session ids, durations, close codes and byte sizes — NEVER frame contents.
  The relay can't read ciphertext anyway; logging must not weaken that guarantee for
  plaintext-visible frames either.
- **Never throw from a frame handler** on malformed/tampered input — report via `onError`, close
  4200 and return early instead, since a hostile or buggy relay must not be able to crash either
  side.
- **Protocol 1 is gone.** The old `e2ee_*` JSON channel, the shared-session bridge and the Cloudflare
  adapter are deleted. A protocol-1 peer's `relay_register` socket is only ever parked by the
  relay (never answered or forwarded); there is no compatibility path.
- **The relay never parses a frame after `relay_paired`.** `relay-server.ts` forwards paired
  sockets' frames as received, text or binary. Adding any parsing there (even for debugging)
  breaks the zero-knowledge property the whole package exists for.
- **`relay-server.ts` and `relay-logger.ts` are never re-exported from the main barrel
  (`index.ts`).** They import `node:http`/`ws`/`node:fs`; re-exporting them there would drag
  those Node-only imports into any bundler that resolves this package's main entry — including
  browser builds of `web-client` (which transitively imports `@av-pi-studio/relay` via
  `@av-pi-studio/client`'s relay transport). New Node-only server-side additions belong behind
  the `"./server"` package.json export subpath, never the main one; this was a real Vite build
  break caught and fixed during npm publish, not theoretical.

---

## Testing

```bash
npx vitest run packages/relay/src/channel.test.ts
npx vitest run packages/relay/src/base64.test.ts
npx vitest run packages/relay/src/control.test.ts
npx vitest run packages/relay/src/relay-server.test.ts
npx vitest run packages/relay/src/relay-logger.test.ts
```
