# `@av-pi-studio/client`

The client-side library for talking to a Pi-Studio daemon: a low-level WebSocket driver
(`DaemonClient`) plus a high-level, typed SDK facade (`PiStudioClient`). This package is what
`@av-pi-studio/cli` is built on, and what any future web/mobile/desktop client should build on
too.

---

## Install

```bash
npm install @av-pi-studio/client
```

## Two layers

1. **`DaemonClient`** — the low-level WebSocket driver: transport lifecycle, the `hello`
   handshake, JSON + binary frame parsing, RPC request/response correlation, ping/pong liveness,
   and a pluggable `Transport` abstraction so tests (or a future non-WebSocket transport) can
   inject their own implementation.
2. **`PiStudioClient`** — a high-level facade over `DaemonClient` with typed, named methods
   (`createAgent`, `agent(id).send(...)`, `providers.listModels(...)`, …) instead of raw
   `request(type, payload)` calls.

Also included: a **`ReconnectionManager`** (exponential-backoff auto-reconnect) and a
**`TerminalStreamRouter`** (demuxes binary terminal frames by slot).

## Quick start

```ts
import { DaemonClient, PiStudioClient, createWebSocketTransport } from "@av-pi-studio/client";

const daemon = new DaemonClient({
  url: "ws://127.0.0.1:6767",
  clientId: "my-stable-client-id",
  clientType: "cli", // "mobile" | "browser" | "cli" | "mcp"
});

await daemon.connect(); // resolves once the hello → status handshake completes

const client = new PiStudioClient(daemon);

const { agentId } = await client.createAgent({
  provider: "pi",
  model: "claude-3-5-sonnet",
  cwd: "~/my-project",
});

const agent = client.agent(agentId);
agent.timeline.subscribe((event) => console.log(event.kind, event));
await agent.send("Add a health-check endpoint");
```

## `DaemonClient`

### Connection lifecycle

`idle → connecting → open → closing → closed`, observable via `onStateChange(handler)`.

### Key methods

| Method | Description |
|---|---|
| `connect()` | Opens the transport, waits for the `hello` → `status` handshake to complete; resolves with the `ServerInfoPayload` |
| `close(code?, reason?)` | Close the transport. There is no separate `disconnect()`. |
| `request<T>(type, params?, timeoutMs?)` | Sends a correlated RPC, resolves with the response or rejects with `RpcError`/`RpcTimeoutError` |
| `sendSession(message)` | Fire-and-forget session message (wrapped in a `session` envelope) — no response awaited |
| `sendBinary(data)` | Send a raw binary frame (terminal/file-transfer) via the transport |
| `ping(timeoutMs?)` | Send a JSON `ping`, await the correlated `pong` (not RFC 6455 ping) |
| `hasFeature(flag)` | `true` iff the last `server_info.features.<flag>` was truthy |
| `onSessionMessage(handler)` | Subscribe to every inbound `session` message; returns an unsubscribe fn |
| `onTerminalFrame(handler)` | Subscribe to every decoded inbound binary terminal frame |
| `onFileTransferFrame(handler)` | Subscribe to every decoded inbound binary file-transfer frame |
| `onStateChange(handler)` | Subscribe to connection state transitions |
| `state` / `serverId` / `features` / `serverCapabilities` | Current connection state and the identity/capabilities from the last handshake |

### Errors

| Class | When it's thrown |
|---|---|
| `RpcError` | The daemon replied with `rpc_error` for this request |
| `RpcTimeoutError` | No response arrived within `rpcTimeoutMs` — **an operation-level failure only**; the socket is left open |

### Constructor options

```ts
interface DaemonClientOptions {
  url: string;
  clientId: string;
  clientType: "mobile" | "browser" | "cli" | "mcp";
  protocolVersion?: number;              // defaults to the current protocol version
  appVersion?: string;
  capabilities?: Record<string, boolean>; // CLIENT_CAPS flags to advertise in `hello`
  transport?: Transport;                  // inject a stub for tests; defaults to native WebSocket
  rpcTimeoutMs?: number;                  // per-request timeout; never tears down the socket
  now?: () => number;                     // inject a clock for deterministic tests
}
```

## `PiStudioClient`

```ts
const client = new PiStudioClient(daemonClient);
```

| Member | Description |
|---|---|
| `createAgent(req)` | `create_agent_request` RPC |
| `agent(agentId)` | Scoped actions for an existing agent (`send`, `interrupt`, `update`, `resume`, `archive`, `delete`, `onUpdate`, `timeline.fetch`/`.subscribe`) |
| `workspace(workspaceId)` | Scoped actions for a workspace |
| `providers` | `listProviders()`, `listModels(provider)`, `listModes(provider)`, `refreshSnapshot()` |
| `onAgentUpdate(handler)` / `onWorkspaceUpdate(handler)` | Subscribe to broadcasts across all agents/workspaces |
| `connection` | Escape hatch back to the underlying `DaemonClient` |
| `importAgentSession(daemon, args)` | Named export — resume a provider-native session by handle |

## Auto-reconnect

```ts
import { ReconnectionManager } from "@av-pi-studio/client";

const mgr = new ReconnectionManager(daemon, { initialDelayMs: 500, maxDelayMs: 30_000 });
mgr.onReconnected(({ attempt, serverId }) => console.log(`reconnected after ${attempt} tries`));
mgr.start(); // arms; automatically retries with exponential backoff on socket drop
mgr.stop();  // disarm
```

Every reconnect attempt calls `daemon.connect()`, which re-sends the full `hello` handshake, so
capabilities and identity are always rehydrated transparently.

## Terminal frame routing

```ts
import { TerminalStreamRouter } from "@av-pi-studio/client";

const router = new TerminalStreamRouter(daemon);
router.start();                                   // begin routing (idempotent)
const unsubscribe = router.subscribeSlot(slot, {
  onOutput: (data) => { /* opcode Output */ },
  onSnapshot: (data) => { /* opcode Snapshot, sent on (re)subscribe */ },
  onRestore: (data) => { /* opcode Restore, reflowable/mode-gated */ },
});
router.sendInput(slot, bytes);                    // opcode Input = 0x02
router.sendResize(slot, rows, cols);              // opcode Resize = 0x03
router.stop();                                    // stop routing; subscribers retained
```

## Custom transports

```ts
interface Transport {
  connect(url: string): Promise<void>;   // resolves once the raw connection is open (pre-handshake)
  sendText(data: string): void;
  sendBinary(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  readonly isOpen: boolean;

  onMessage: ((data: string | ArrayBuffer | Blob) => void) | null;
  onClose: ((code: number, reason: string) => void) | null;
  onError: ((error: unknown) => void) | null;
}
```

`createWebSocketTransport(factory?: WsFactory)` is the default Node/browser WebSocket-backed
implementation. `factory` is an injectable `(url, protocols?) => AnyWebSocket` — inject a stub for
tests, or a custom factory to carry a bearer-password subprotocol (there is no built-in `password`
parameter; see `web-client`'s `connection-store.ts` for that pattern).

### Relay transport (E2EE, via `@av-pi-studio/relay`)

```ts
import { createRelayTransport, parsePairingUrl } from "@av-pi-studio/client";

const offer = parsePairingUrl(pairingUrlOrFragment); // { publicKey, publicKeyB64, host? }
const transport = createRelayTransport({
  sessionId: relaySessionId, // rendezvous id shared with the daemon's outbound relay connection
  daemonPublicKey: offer!.publicKey,
});

const daemon = new DaemonClient({ url: relayWsUrl, clientId, clientType: "cli", transport });
await daemon.connect(); // completes the E2EE handshake before the `hello` RPC ever crosses the wire
```

`createRelayTransport` implements the exact same `Transport` contract as
`createWebSocketTransport` — swap it in via `DaemonClientOptions.transport` and every other
`DaemonClient`/`PiStudioClient` API works unchanged, whether the daemon is direct or reached
through a relay. See `@av-pi-studio/relay`'s README for running a relay server and
`@av-pi-studio/server`'s README for pointing a daemon at one.

## Design rules

- **`RpcTimeoutError` never closes the socket.** A slow RPC is an operation-level failure, not a
  connection failure.
- **`clientId` stays stable across reconnects** — it identifies the logical client session, not
  the physical connection.
- **No DOM/Node-specific globals** in `daemon-client.ts` or the base `Transport` type — only
  `createWebSocketTransport` itself touches the platform WebSocket, and the base driver never
  imports it directly.

## Development

```bash
npm run build       # tsc -b
npx vitest run packages/client
```

Tests inject stub `Transport` implementations and mock clocks — no real sockets are opened.
