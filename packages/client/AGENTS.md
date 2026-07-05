# `@av-pi-studio/client` — AGENTS.md

Low-level WebSocket driver (`DaemonClient`) and high-level SDK facade (`PiStudioClient`).
This package is consumed by `cli`, `app`, and any future web/desktop client.

---

## Purpose

Provides two layers:

1. **`DaemonClient`** — low-level: WebSocket transport, `hello` handshake, JSON+binary framing,
   RPC correlation (request → response by `requestId`), ping/pong liveness, session-message
   fan-out, and a pluggable `Transport` abstraction.
2. **`PiStudioClient`** — high-level facade: typed handles for agents, workspaces, and providers
   that wrap `DaemonClient.request()` calls with named methods matching the server RPC types.
3. **`ReconnectionManager`** — exponential backoff reconnector that re-issues the `hello`
   handshake after a socket drop and rehydrates `serverId`/`features`.
4. **`TerminalStreamRouter`** — demuxes incoming binary terminal frames by slot and fan-outs them
   to per-slot subscriber sets.

---

## Source layout

```
src/
  index.ts                    Public barrel (re-exports everything below).
  daemon-client.ts            DaemonClient — WS driver, handshake, RPC, liveness.
  daemon-client.test.ts
  pistudio-client.ts          PiStudioClient — high-level SDK facade.
  pistudio-client.test.ts
  reconnect.ts                ReconnectionManager — backoff reconnect + capability rehydrate.
  terminal-stream-router.ts   TerminalStreamRouter — binary frame demux by slot.
  terminal-router.test.ts
  transport.ts                Transport interface + createWebSocketTransport().
```

---

## `DaemonClient` (`daemon-client.ts`)

### Connection lifecycle states

`idle → connecting → open → closing → closed`

### Key methods

| Method | Description |
|--------|-------------|
| `connect()` | Open the transport, wait for `server_info` (resolves after hello→status handshake) |
| `disconnect()` | Graceful close |
| `request<T>(type, payload, opts?)` | Send a session RPC, await correlated response. Rejects with `RpcError` or `RpcTimeoutError`. |
| `onSessionMessage(handler)` | Subscribe to all inbound session messages. Returns unsubscribe fn. |
| `onTerminalFrame(handler)` | Subscribe to all binary terminal frames. Returns unsubscribe fn. |
| `onStateChange(handler)` | Subscribe to connection state transitions. Returns unsubscribe fn. |
| `state` | Current `ConnectionState` |
| `serverId` | Server identity from the last `server_info` |
| `features` | Feature flags map from the last `server_info` |
| `serverCapabilities` | Capability map from the last `server_info` |

### Error types

| Class | When |
|-------|------|
| `RpcError` | Server replied with `rpc_error` for the correlated request |
| `RpcTimeoutError` | No response within `rpcTimeoutMs`. Does NOT close the socket. |

### Constructor options (`DaemonClientOptions`)

```ts
{
  url: string;              // WebSocket URL (e.g. "ws://127.0.0.1:6767")
  clientId: string;         // Stable client identity sent in hello
  clientType: ClientType;   // "mobile" | "browser" | "cli" | "mcp"
  protocolVersion?: number; // Defaults to PROTOCOL_VERSION = 1
  appVersion?: string;
  capabilities?: Record<string, boolean>; // CLIENT_CAPS flags to advertise
  transport?: Transport;    // Inject for tests or relay; defaults to native WebSocket
  rpcTimeoutMs?: number;    // Default RPC timeout; operation-level only, no socket teardown
  now?: () => number;       // Inject clock for deterministic tests
}
```

### Framing behaviour

- **Text frames**: parsed as `TopLevelEnvelope`. `ping` triggers an immediate `pong`. `session`
  envelopes are broadcast to all `onSessionMessage` subscribers. `status`/`pong` are handled
  internally (handshake resolution / liveness tracking).
- **Binary frames**: decoded by `decodeTerminalFrame()` from `@av-pi-studio/protocol`, then
  broadcast to all `onTerminalFrame` subscribers.

---

## `PiStudioClient` (`pistudio-client.ts`)

High-level facade constructed over a `DaemonClient`:

```ts
const client = new PiStudioClient(daemonClient);
```

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `createAgent(req)` | `Promise<{ agentId, … }>` | `create_agent_request` RPC |
| `agent(agentId)` | `PiStudioAgentActions` | Scoped handle for an existing agent |
| `workspace(workspaceId)` | `PiStudioWorkspaceActions` | Scoped handle for a workspace |
| `providers` | `PiStudioProviderActions` | List providers/models/modes, refresh snapshot |
| `onAgentUpdate(handler)` | unsubscribe fn | Subscribe to all `agent_update` broadcasts |
| `onWorkspaceUpdate(handler)` | unsubscribe fn | Subscribe to all `workspace_update` broadcasts |
| `connection` | `DaemonClient` | Escape hatch to the underlying driver |

### `PiStudioAgentActions` (from `agent(id)`)

| Method | RPC |
|--------|-----|
| `send(prompt, opts?)` | `send_agent_prompt` |
| `run(prompt, opts?)` | alias for `send` |
| `interrupt()` | `interrupt_agent` |
| `update(patch)` | `update_agent` (model/mode/thinking/features/title/labels) |
| `resume()` | `resume_agent` |
| `archive()` | `archive_agent` |
| `onUpdate(handler)` | Subscribe to `agent_update` for this agent only |
| `timeline.fetch(opts?)` | `fetch_agent_timeline_request` |
| `timeline.subscribe(handler)` | Subscribe to `agent_stream` for this agent only |

### `PiStudioProviderActions` (from `providers`)

| Method | RPC |
|--------|-----|
| `listProviders()` | `list_providers` |
| `listModels(provider)` | `list_provider_models` |
| `listModes(provider)` | `list_provider_modes` |
| `refreshSnapshot()` | `providers.snapshot.refresh.request` |

### `importAgentSession(daemon, args)` (named export)

Sends `import_agent_session` RPC — not agent-scoped.

---

## `ReconnectionManager` (`reconnect.ts`)

Drives automatic reconnect after socket drop:

- Exponential backoff with configurable `initialDelayMs`, `maxDelayMs`, `factor`, `jitter`.
- On each attempt: calls `daemonClient.connect()` which re-issues the full `hello` handshake.
- Fires `onReconnected(handler)` after success; `onReconnectFailed(handler)` on error.
- All timer/RNG dependencies are injectable for deterministic tests.

```ts
const mgr = new ReconnectionManager(daemonClient, opts);
mgr.onReconnected(({ attempt, serverId }) => { … });
mgr.start();   // arm; auto-reconnects on state → "closed"
mgr.stop();    // disarm
```

---

## `TerminalStreamRouter` (`terminal-stream-router.ts`)

Demuxes binary terminal frames by `slot`:

```ts
const router = new TerminalStreamRouter();
const unsub = router.subscribe(slot, (frame: TerminalFrame) => { … });
router.handleFrame(frame);   // called from DaemonClient.onTerminalFrame()
```

---

## `Transport` interface (`transport.ts`)

```ts
interface Transport {
  connect(): Promise<void>;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onMessage(handler: (data: string | Uint8Array) => void): () => void;
  onClose(handler: (code: number, reason: string) => void): () => void;
  onError(handler: (err: Error) => void): () => void;
  readonly readyState: "connecting" | "open" | "closing" | "closed";
}
```

`createWebSocketTransport(url, password?)` returns the default browser/Node WebSocket-backed
implementation. Inject a stub `Transport` in tests or wire in the relay transport (sprint-013).

---

## Invariants

- **`RpcTimeoutError` must NOT close the socket.** It is an operation-level failure.
- **`clientId` must be stable** across reconnects (same session identity).
- **`hello` is re-sent on every `connect()` call**, including reconnects — `DaemonClient` always
  sends the same capabilities map so reconnect rehydrates them transparently.
- **No DOM/Node-specific globals** in `daemon-client.ts` or `transport.ts` except inside
  `createWebSocketTransport` (which is not imported by the base driver).
- **`crypto.randomUUID`** is used for request IDs with a `Date.now()`+`Math.random()` fallback for
  environments that lack it.

---

## Testing

```bash
npm test -- --project packages/client
```

Tests inject stub `Transport` implementations and mock clocks; they do not open real sockets.
