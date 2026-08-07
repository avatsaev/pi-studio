# `@av-pi-studio/relay` — AGENTS.md

E2EE relay channel primitives, plus a standalone runnable relay server. Lets a client reach a
daemon behind a firewall/NAT without opening inbound ports, while the relay itself stays
zero-knowledge (see `swe/architecture/relay-e2ee.md`). Published to npm as
`@av-pi-studio/relay`; ships both as a library and as a `pi-studio-relay` CLI binary.

---

## Purpose

Provides the encrypted **channel** abstraction shared by the daemon (outbound relay dial,
`packages/server`'s `relay-transport.ts`) and the client (relay transport, `packages/client`'s
`relay-transport.ts`). Both sides construct a channel over an abstract `Transport` (any send/receive
text-frame link) and get an identical API: `createDaemonChannel` / `createClientChannel`.

Also ships two ways to actually run a relay:
- **Hosted**: `cf-adapter.ts`/`session-bridge.ts` — a Cloudflare Workers WebSocketPair adapter.
- **Self-hosted**: `relay-server.ts`/`relay-main.ts` — a plain Node process, runnable directly
  (`npx @av-pi-studio/relay`), managed by `packages/cli`'s `pi-studio relay start|stop|status`, or
  containerized via `docker/relay.Dockerfile` (tiny stateless image; see `docker/README.md`).

Either way, the relay only ever forwards frames produced by this package's channel layer — it
never has the keys to read or forge them.

---

## Source layout

```
src/
  index.ts             Re-exports channel.ts, base64.ts, session-id.ts, session-bridge.ts,
                        cf-adapter.ts. Deliberately does NOT re-export relay-server.ts /
                        relay-logger.ts (Node-only: node:http, ws, node:fs) — see "./server"
                        subpath export below.
  channel.ts           createClientChannel(), createDaemonChannel(), Transport,
                        EncryptedChannelEvents, ConnectionRole, RelaySessionAttachment,
                        EncryptedChannel.
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
  session-bridge.ts     RelaySessionBridge — platform-agnostic verbatim frame-forwarding core any
                        relay server implementation bridges through (register by session id,
                        forward everything else untouched).
  session-bridge.test.ts
  cf-adapter.ts          createCloudflareRelayHandler() — thin Cloudflare Workers WebSocketPair
                        wrapper around RelaySessionBridge. Hosted deployment/ops (wrangler config,
                        the `fetch` export) are OUT of scope — this is the reusable bridging hook a
                        `fetch` handler wires an upgrade through.
  cf-adapter.test.ts
  relay-server.ts       startRelayServer() — standalone, runnable self-hosted relay: a plain Node
                        `http`+`ws` WebSocket server wired to the same RelaySessionBridge, plus a
                        bare `GET /health` (200 `ok`) liveness endpoint. Node-only (imports
                        `node:http`, `ws`) — exposed via the `"./server"` package export subpath,
                        NOT the main barrel, so it never drags `node:http` into a browser bundle
                        that transitively imports this package (e.g. web-client, via
                        `@av-pi-studio/client`'s relay transport).
  relay-server.test.ts
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

### `createDaemonChannel(opts): EncryptedChannel`
```ts
interface CreateDaemonChannelOptions {
  transport: Transport;
  attachment: RelaySessionAttachment;
  /** The daemon's PERSISTENT keypair (`daemon-keypair.json`) — not per-connection ephemeral. */
  daemonKeypair: { publicKey: Uint8Array; secretKey: Uint8Array };
  events?: EncryptedChannelEvents;
}
```
Waits for the peer's `e2ee_hello { ephemeralPublicKey }`, derives `sharedKey = ECDH(daemonSecret,
clientEphemeralPublic)`, replies `e2ee_ready`, then becomes `ready`. Refuses (silently drops) any
`e2ee_app` frame received before that. **Re-arms on every subsequent `e2ee_hello` too** — it does
NOT latch onto the first client forever. The relay places no cap on how many sockets attach to one
session id (a browser reload, a second tab, or a plain reconnect are all indistinguishable from a
brand-new peer at the bridge layer), so the SAME long-lived daemon channel object can legitimately
see a hello from a different client days after the first one. Re-deriving the shared key on each
hello is idempotent for an actual replay (same ephemeral key → same shared key) and correct for a
genuinely new peer ("last hello wins"); the alternative — ignoring every hello after the first —
was a real bug: every peer but the first got stuck forever below `ready`
(`cannot send before the E2EE handshake completes`), since the daemon never replied `e2ee_ready`.

### `createClientChannel(opts): EncryptedChannel`
```ts
interface CreateClientChannelOptions {
  transport: Transport;
  attachment: RelaySessionAttachment;
  /** The daemon's persistent public key, obtained via the pairing offer (URL fragment). */
  daemonPublicKey: Uint8Array;
  events?: EncryptedChannelEvents;
}
```
Generates a FRESH ephemeral Curve25519 keypair, derives the shared key immediately (it already
knows the daemon's persistent public key), sends `e2ee_hello`, and becomes `ready` only once
`e2ee_ready` arrives.

### `EncryptedChannel`
```ts
interface EncryptedChannel {
  readonly role: "client" | "daemon";
  readonly attachment: RelaySessionAttachment;   // { sessionId }
  readonly ready: boolean;
  send(plaintext: string): void;        // text app traffic — throws if not ready, or after close()
  sendBinary(bytes: Uint8Array): void;  // binary app traffic (terminal I/O, file-transfer chunks) —
                                         // same crypto/gating as send(), tagged e2ee_bin not e2ee_app
  close(): void;
}
```
`sendBinary`/`onBinaryMessage` are the binary siblings of `send`/`onMessage` — identical
handshake gating, identical ECDH shared key, identical auth-failure-drops-silently behavior, just
fed raw bytes and tagged `e2ee_bin` on the wire instead of `e2ee_app`. Still a JSON text WS frame
under the hood (base64-wrapped ciphertext) — no raw binary WebSocket frames are involved, so
nothing downstream of the channel layer (the bridge, the self-hosted relay, the Cloudflare
adapter) needed to change to support this.

### `deriveRelaySessionId(publicKey: Uint8Array): string` (`session-id.ts`)
SHA-512 of the public key, truncated to the first 16 bytes (32 lowercase hex chars). Pure function,
deterministic — same key always yields the same id, distinct keys always yield distinct ids (see
"Source layout" above for why this exists). Used as the default `sessionId` on both sides of a
relay-routed pairing: the daemon's outbound dial and the client's relay transport when no
`sessionId` is passed explicitly.

### `Transport` (caller-supplied; the concrete relay WS transport is wired in by task-002/003)
```ts
interface Transport {
  send(data: string): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: (reason?: string) => void): void;
  close(): void;
}
```

---

## Public API (`src/session-bridge.ts`, `src/cf-adapter.ts`)

```ts
class RelaySessionBridge {
  constructor(events?: RelayBridgeEvents); // optional metadata-only lifecycle hooks (logging)
  attach(socket: RelaySocket): void;     // pairs sockets by session id; forwards non-registration frames verbatim
  peerCount(sessionId: string): number;  // observability/test helper
}

interface RelayBridgeEvents {
  onRegisterRejected?(socket): void;                    // first frame wasn't relay_register (still ignored)
  onRegister?(socket, sessionId, peers): void;          // peers = post-add session socket count
  onForward?(sessionId, bytes): void;                   // per peer delivery, frame SIZE only
  onUnregister?(socket, sessionId, peers): void;        // peers = post-removal count
}

function createCloudflareRelayHandler(opts: {
  bridge: RelaySessionBridge;
  createWebSocketPair?: () => CfWebSocketPair;  // inject in tests; defaults to the real Workers global
}): (upgradeHeader: string | null) => { status: number; webSocket?: CfWebSocket };
```
`RelayBridgeEvents` is how the relay server logs without ever inspecting traffic: every hook
receives only metadata the relay already legitimately sees (session ids, peer counts, frame
sizes) — never frame contents. A hook that parses or logs payload data would break the
zero-knowledge property just as surely as parsing in `attach()` would.

`RelaySessionBridge` is the platform-agnostic bridging core — it inspects ONLY the first frame a
socket sends (to detect `{"type":"relay_register","sessionId":"..."}`, matching the daemon/client
registration convention from task-002/003); every subsequent frame is forwarded byte-for-byte to
every OTHER socket sharing that session id, with **no** `JSON.parse` or inspection beyond that. This
is the literal implementation of "a compromised relay can see only metadata... never message
contents" — the bridge structurally cannot read `e2ee_app` ciphertext because it never looks at it.
**No cap on peers per session id** — the backing `Set<RelaySocket>` grows unbounded as sockets
register; the bridge doesn't know or care that the E2EE protocol above it expects "one daemon,
one client" at a time. A daemon channel that dials once and lives for its whole process (the real
deployment shape — see `relay-transport.ts`) can see MANY client sockets attach/detach under the
same session id over its lifetime; `createDaemonChannel` is responsible for handling each one's
`e2ee_hello` correctly, not the bridge.

`createCloudflareRelayHandler` is a thin adapter: on a WebSocket upgrade it creates a
`WebSocketPair`, `.accept()`s the SERVER side, attaches it to the bridge, and returns the CLIENT
side for the caller's `fetch` handler to return in a `101` response
(`new Response(null, { webSocket, status: 101 })`). It deliberately declares its own minimal
structural `CfWebSocket`/`CfWebSocketPair` types instead of depending on
`@cloudflare/workers-types`, so the browser-safe main barrel stays free of platform-specific type
dependencies; the real Workers globals satisfy the structural shape naturally.

## Public API (`src/relay-server.ts`, `src/relay-main.ts`)

```ts
function startRelayServer(opts: {
  host?: string;  // default "0.0.0.0" — unlike the daemon, the relay must accept remote dials
  port: number;
  logger?: RelayLogger;  // default: silent (tests/embedded); relay-main.ts passes a real stdout logger
}): Promise<{
  host: string; port: number; bridge: RelaySessionBridge;
  close(): Promise<void>;
}>;
```
A plain Node `http` server exposing `GET /health` (200 `ok`) plus a `ws.WebSocketServer` that
`attach()`es every incoming socket to a fresh `RelaySessionBridge` — daemon and client connections
are treated identically; the bridge only distinguishes them by session id, never by role.

With a logger injected, the server logs the full connection lifecycle: `connection open` (short
conn id + remote address), `session registered` (session id + peer count; "both peers attached"
when the second peer joins), `peer detached`, `connection closed` (close code, durationMs,
bytesIn/bytesOut per connection), warns on pre-registration non-register frames, and errors on
socket failures. Frame forwarding is logged at `trace` level with byte counts only.

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

- Handshake frames (JSON, **plaintext**, visible to the relay): `{"type":"e2ee_hello","ephemeralPublicKey":"<base64>"}`,
  `{"type":"e2ee_ready"}`.
- App frames: `{"type":"e2ee_app","frame":"<base64(nonce ++ ciphertext)>"}` where `nonce` is 24
  random bytes and `ciphertext = nacl.box.after(utf8(plaintext), nonce, sharedKey)`
  (XSalsa20-Poly1305). Receive: split nonce/ciphertext, `nacl.box.open.after`; auth failure → the
  frame is silently dropped and `onAuthError` fires — it never throws into the transport's message
  loop.

---

## Invariants

- **The daemon's persistent secret never leaves the daemon.** `createDaemonChannel` takes the
  identity keypair directly — do not generate a throwaway keypair for it, or the client (which
  derives its shared key from the daemon's known public key before the handshake even starts) will
  never be able to compute a matching key.
- **The client's keypair is always fresh per channel** (no persistent client-side secret to steal).
- **Session-key freshness**: a new channel = a new ECDH derivation, so ciphertext cannot replay
  across sessions. Replay protection **within** a live session is NOT implemented (random nonces,
  no counter) — TODO(verify) per architecture/relay-e2ee.md.
- **No Node-only APIs** in the main-barrel modules (`base64.ts`; `channel.ts` uses
  `TextEncoder`/`TextDecoder`, also available in browsers/RN) — everything `index.ts` re-exports
  must run identically in the daemon and in a browser/RN client transport. Node-only code
  (`relay-server.ts`, `relay-logger.ts`) lives behind the `"./server"` subpath.
- **Relay logs are metadata-only.** Any logging wired to `RelayBridgeEvents` (or added to
  `relay-server.ts`) may record connection ids, remote addresses, session ids, peer counts,
  durations, and byte sizes — NEVER frame contents. The relay can't read ciphertext anyway;
  logging must not weaken that guarantee for plaintext-visible frames either.
- **Never throw from a message handler** on malformed/tampered input — drop and report via
  `onAuthError`/return early instead, since a hostile or buggy relay must not be able to crash
  either side.
- **A daemon channel must accept a fresh `e2ee_hello` at any point in its life, not just once.**
  The relay imposes no cap on peers per session id (`RelaySessionBridge.attach` — see
  `peerCount`), and the daemon dials the relay once for its whole process lifetime under one
  deterministic session id (`relay-transport.ts`). A browser reload, a second tab, or a plain
  reconnect are all just "another socket sends `relay_register` under the same session id" from
  the bridge's point of view — `createDaemonChannel` MUST re-derive and re-arm rather than
  latching `ready` to the first peer forever. Regression test:
  `session-bridge.test.ts`'s "a SECOND client, connecting after the first one dropped, …" — it
  hangs/times out without the re-arm fix and passes with it.
- **`RelaySessionBridge.attach()` never inspects post-registration frames.** Adding any parsing
  there (even for debugging) breaks the zero-knowledge property the whole package exists for.
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
npx vitest run packages/relay/src/session-bridge.test.ts
npx vitest run packages/relay/src/cf-adapter.test.ts
npx vitest run packages/relay/src/relay-server.test.ts
npx vitest run packages/relay/src/relay-logger.test.ts
```
