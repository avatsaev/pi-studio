# `@av-pi-studio/relay` — AGENTS.md

E2EE relay channel primitives, plus a standalone runnable relay server. Lets a client reach a
daemon behind a firewall/NAT without opening inbound ports, while the relay itself stays
zero-knowledge (see `clean-room-scope/architecture/relay-e2ee.md`). Published to npm as
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
  index.ts             Re-exports channel.ts, base64.ts, session-bridge.ts, cf-adapter.ts.
                        Deliberately does NOT re-export relay-server.ts (Node-only: node:http, ws)
                        — see "./server" subpath export below.
  channel.ts           createClientChannel(), createDaemonChannel(), Transport,
                        EncryptedChannelEvents, ConnectionRole, RelaySessionAttachment,
                        EncryptedChannel.
  channel.test.ts
  base64.ts             Pure-JS base64 codec (no Node Buffer — runs in browser/RN too).
  base64.test.ts
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
  relay-main.ts          Process entry (`bin: pi-studio-relay`). Reads `--listen host:port` /
                        `PI_STUDIO_RELAY_LISTEN` (default `0.0.0.0:7000`), calls
                        startRelayServer(), shuts down cleanly on SIGINT/SIGTERM. This is what
                        `npx @av-pi-studio/relay` runs directly and what `pi-studio relay start`
                        (packages/cli's relay-control.ts) spawns as a detached child process.
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
`e2ee_app` frame received before that.

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
  send(plaintext: string): void;   // throws if not ready, or after close()
  close(): void;
}
```

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
  attach(socket: RelaySocket): void;     // pairs sockets by session id; forwards non-registration frames verbatim
  peerCount(sessionId: string): number;  // observability/test helper
}

function createCloudflareRelayHandler(opts: {
  bridge: RelaySessionBridge;
  createWebSocketPair?: () => CfWebSocketPair;  // inject in tests; defaults to the real Workers global
}): (upgradeHeader: string | null) => { status: number; webSocket?: CfWebSocket };
```
`RelaySessionBridge` is the platform-agnostic bridging core — it inspects ONLY the first frame a
socket sends (to detect `{"type":"relay_register","sessionId":"..."}`, matching the daemon/client
registration convention from task-002/003); every subsequent frame is forwarded byte-for-byte to
every OTHER socket sharing that session id, with **no** `JSON.parse` or inspection beyond that. This
is the literal implementation of "a compromised relay can see only metadata... never message
contents" — the bridge structurally cannot read `e2ee_app` ciphertext because it never looks at it.

`createCloudflareRelayHandler` is a thin adapter: on a WebSocket upgrade it creates a
`WebSocketPair`, `.accept()`s the SERVER side, attaches it to the bridge, and returns the CLIENT
side for the caller's `fetch` handler to return in a `101` response
(`new Response(null, { webSocket, status: 101 })`). It deliberately declares its own minimal
structural `CfWebSocket`/`CfWebSocketPair` types instead of depending on
`@cloudflare/workers-types`, so this zero-runtime-dependency package stays that way; the real
Workers globals satisfy the structural shape naturally.

## Public API (`src/relay-server.ts`, `src/relay-main.ts`)

```ts
function startRelayServer(opts: {
  host?: string;  // default "0.0.0.0" — unlike the daemon, the relay must accept remote dials
  port: number;
}): Promise<{
  host: string; port: number; bridge: RelaySessionBridge;
  close(): Promise<void>;
}>;
```
A plain Node `http` server exposing `GET /health` (200 `ok`) plus a `ws.WebSocketServer` that
`attach()`es every incoming socket to a fresh `RelaySessionBridge` — daemon and client connections
are treated identically; the bridge only distinguishes them by session id, never by role.

`relay-main.ts` is the CLI-facing process entry (`bin: pi-studio-relay`): parses `--listen host:port`
/ `PI_STUDIO_RELAY_LISTEN` (default `0.0.0.0:7000`), calls `startRelayServer`, logs the bound
address, and closes cleanly on `SIGINT`/`SIGTERM`. `packages/cli`'s `relay-control.ts` resolves
`startRelayServer` via `import.meta.resolve("@av-pi-studio/relay/server")` (the subpath export, not
the main barrel) to spawn/manage it as a supervised subprocess for `pi-studio relay
start|stop|status`.

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
- **No Node-only APIs** in `base64.ts` (`channel.ts` uses `TextEncoder`/`TextDecoder`, also
  available in browsers/RN) — the whole package must run identically in the daemon and in a future
  browser/RN client transport.
- **Never throw from a message handler** on malformed/tampered input — drop and report via
  `onAuthError`/return early instead, since a hostile or buggy relay must not be able to crash
  either side.
- **`RelaySessionBridge.attach()` never inspects post-registration frames.** Adding any parsing
  there (even for debugging) breaks the zero-knowledge property the whole package exists for.
- **`relay-server.ts` is never re-exported from the main barrel (`index.ts`).** It imports
  `node:http`/`ws`; re-exporting it there would drag those Node-only imports into any bundler that
  resolves this package's main entry — including browser builds of `web-client` (which transitively
  imports `@av-pi-studio/relay` via `@av-pi-studio/client`'s relay transport). New Node-only
  server-side additions belong behind the `"./server"` package.json export subpath, never the main
  one; this was a real Vite build break caught and fixed during npm publish, not theoretical.

---

## Testing

```bash
npx vitest run packages/relay/src/channel.test.ts
npx vitest run packages/relay/src/base64.test.ts
npx vitest run packages/relay/src/session-bridge.test.ts
npx vitest run packages/relay/src/cf-adapter.test.ts
npx vitest run packages/relay/src/relay-server.test.ts
```
