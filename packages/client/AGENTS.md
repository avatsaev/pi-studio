# `@av-pi-studio/client` — AGENTS.md

Low-level WebSocket driver (`DaemonClient`) and high-level SDK facade (`PiStudioClient`), plus
relay E2EE transport, pairing, and binary-frame demux (terminal + file-transfer). This package is
consumed by `cli` and `web-client`.

---

## Purpose

Provides:

1. **`DaemonClient`** — low-level: WebSocket (or relay) transport, `hello` handshake, JSON+binary
   framing, RPC correlation (request → response by `requestId`), ping/pong liveness, session-message
   and binary-frame fan-out, and a pluggable `Transport` abstraction.
2. **`PiStudioClient`** — high-level facade: typed handles for agents, workspaces, and providers
   that wrap `DaemonClient.request()` calls with named methods matching the server RPC types.
3. **`ReconnectionManager`** — exponential backoff reconnector that re-issues the `hello`
   handshake after a socket drop and rehydrates `serverId`/`features`.
4. **`TerminalStreamRouter`** — demuxes incoming binary terminal frames by slot to per-slot
   subscribers, and encodes outbound input/resize frames.
5. **`FileTransferClient`** — demuxes incoming binary file-download frames, assembling
   `Begin → Chunk* → End` into one buffer per request, and drives chunked uploads the other way
   (request an upload stream, then push `Begin → Chunk* → End` frames the server writes to disk).
6. **`createRelayTransport`** + **`parsePairingUrl`** — the client side of the E2EE relay: connects
   through a relay server instead of directly to the daemon, using the same `Transport` interface
   as a direct WebSocket, so `DaemonClient` doesn't need to know which one it's using.

---

## Source layout

```
src/
  index.ts                    Public barrel (re-exports everything below).
  transport.ts                Transport interface + AnyWebSocket/WsFactory + createWebSocketTransport().
  relay-transport.ts          createRelayTransport() + relayDialUrl() — E2EE relay Transport (same interface as direct WS).
  relay-transport.test.ts
  pairing.ts                  parsePairingUrl() — parse the pairing-URL fragment (offer + host or offer + relay/relayTls).
  daemon-client.ts            DaemonClient — WS/relay driver, handshake, RPC, liveness.
  daemon-client.test.ts
  pistudio-client.ts          PiStudioClient — high-level SDK facade + agent/workspace/provider handles.
  pistudio-client.test.ts
  reconnect.ts                ReconnectionManager — backoff reconnect + capability rehydrate.
  terminal-stream-router.ts   TerminalStreamRouter — binary terminal frame demux/encode by slot.
  terminal-router.test.ts
  file-transfer-client.ts     FileTransferClient — binary file-download/-upload frame demux + assembly.
  file-transfer-client.test.ts
```

---

## `Transport` interface (`transport.ts`)

The abstraction shared by direct WebSocket and relay transports — `DaemonClient` only ever talks
to this interface, never to a raw socket:

```ts
interface Transport {
  connect(url: string): Promise<void>;      // resolves once the raw connection is open (pre-handshake)
  sendText(data: string): void;
  sendBinary(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  readonly isOpen: boolean;

  onMessage: ((data: string | ArrayBuffer | Blob) => void) | null;
  onClose: ((code: number, reason: string) => void) | null;
  onError: ((error: unknown) => void) | null;
}
```

`createWebSocketTransport(factory?: WsFactory)` — default direct-WebSocket implementation.
`factory` is an injectable `(url, protocols?) => AnyWebSocket` (tests, or a custom factory carrying
a bearer-password subprotocol — see `web-client`'s `connection-store.ts` for that pattern). With no
factory it uses the global `WebSocket` (browser/RN/Node ≥ 22). `connect()` forces
`ws.binaryType = "arraybuffer"` on the created socket (browsers/RN default to `"blob"`, which would
otherwise route every binary frame through `DaemonClient.handleIncoming`'s async `Blob.arrayBuffer()`
path — independent Blob decodes across messages have no guaranteed resolution order relative to
wire order, so a straggler could finish decoding after a later frame's, and for a chunked
file-transfer download that reordering let `FileTransferClient.dispatch()`'s `End`-frame handling
delete the stream's pending state before a late `Chunk` arrived, silently dropping it — real bug,
truncated downloaded/inline images with the bottom rows missing). Node `ws` always delivers
`Buffer`/`ArrayBuffer` synchronously regardless of this property. The `Blob` branch in `onmessage`
is dead in normal operation now; kept only as a defensive fallback for a `WebSocket`-like object
that ignores `binaryType`.

`createRelayTransport({ sessionId?, daemonPublicKey, factory? })` (`relay-transport.ts`) —
implements the identical `Transport` interface over an E2EE relay: dials the relay's own WebSocket
address (NOT the daemon's — build it from a pairing offer's `relay` info via `relayDialUrl()`),
registers under `sessionId` (or, when omitted, `deriveRelaySessionId(daemonPublicKey)` — the SAME
deterministic id the daemon's own outbound dial always registers under,
`packages/server/src/daemon/relay-transport.ts` — so a pairing offer's public key alone is enough
to find the daemon on the relay without a separately-transmitted session id), completes the
`e2ee_hello`/`e2ee_ready` handshake via `createClientChannel` (`@av-pi-studio/relay`) with a
**fresh ephemeral** keypair, and only reports `isOpen` once that handshake finishes — no app RPC
(including `hello`) can cross the wire before then. `sendBinary()` works too (terminal I/O,
file-transfer chunks) — carried as the channel's `e2ee_bin` sibling wire frame to text `e2ee_app`
(`@av-pi-studio/relay`'s `channel.ts`); still a JSON text WS frame under the hood (base64-wrapped
ciphertext), never a raw binary WebSocket frame, so no relay-server change was needed.

`parsePairingUrl(input)` (`pairing.ts`) parses a pairing URL's fragment
(`#offer=<base64>&host=...` or, for a relay-routed daemon, `#offer=<base64>&relay=<endpoint>
&relayTls=<0|1>`) into `{ publicKeyB64, publicKey, host? }` or `{ publicKeyB64, publicKey, relay:
{ endpoint, useTls } }` — `host` and `relay` are mutually exclusive, matching
`packages/cli/src/pairing.ts#buildPairingUrl`'s output. `publicKey` feeds `createRelayTransport`'s
`daemonPublicKey` directly; `relay` feeds `relayDialUrl()` + the transport's default session id.
Returns `null` (never throws) if no `offer` param is present — callers must treat that as "not a
valid pairing link," never fall back to an unauthenticated connection.

---

## `DaemonClient` (`daemon-client.ts`)

### Connection lifecycle states

`idle → connecting → open → closing → closed`

### Key methods

| Method | Description |
|--------|-------------|
| `connect()` | Open the transport, complete the `hello`→`server_info` handshake. Resolves with the `ServerInfoPayload`. |
| `close(code?, reason?)` | Close the transport. There is no separate `disconnect()`. |
| `request<T>(type, params?, timeoutMs?)` | Send a session RPC, await correlated response. Rejects with `RpcError` or `RpcTimeoutError`. |
| `sendSession(message)` | Fire-and-forget session message (wrapped in a `session` envelope) — no response awaited. |
| `sendBinary(data)` | Send a raw binary frame (terminal/file-transfer) via the transport. |
| `ping(timeoutMs?)` | Send a JSON `ping`, await the correlated `pong` (NOT RFC 6455 ping). |
| `hasFeature(flag)` | `true` iff the last `server_info.features.<flag>` was truthy. |
| `onSessionMessage(handler)` | Subscribe to all inbound session messages. Returns unsubscribe fn. |
| `onTerminalFrame(handler)` | Subscribe to decoded inbound terminal binary frames. Returns unsubscribe fn. |
| `onFileTransferFrame(handler)` | Subscribe to decoded inbound file-transfer binary frames. Returns unsubscribe fn. |
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
  url: string;              // WebSocket URL (e.g. "ws://127.0.0.1:6767") — passed to transport.connect()
  clientId: string;         // Stable client identity sent in hello
  clientType: ClientType;   // "mobile" | "browser" | "cli" | "mcp"
  protocolVersion?: number; // Defaults to PROTOCOL_VERSION = 1
  appVersion?: string;
  capabilities?: Record<string, boolean>; // CLIENT_CAPS flags to advertise
  transport?: Transport;    // Inject for tests or relay; defaults to createWebSocketTransport()
  rpcTimeoutMs?: number;    // Default RPC timeout; operation-level only, no socket teardown
  now?: () => number;       // Inject clock for deterministic tests
}
```

### Framing behaviour

- **Text frames**: parsed as `TopLevelEnvelope`. `ping` triggers an immediate `pong`. `session`
  envelopes are broadcast to all `onSessionMessage` subscribers. `status`/`pong` are handled
  internally (handshake resolution / liveness tracking).
- **Binary frames**: decoded first via `decodeTerminalFrame()`, then (if that fails) via
  `tryDecodeFileTransferFrame()` (both from `@av-pi-studio/protocol`), and broadcast to the matching
  `onTerminalFrame`/`onFileTransferFrame` subscribers.

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

`sessionStats()` through `lastAssistantText()` (sprint-037) mirror Pi built-in slash commands that
have a real Pi RPC equivalent (`/session`, `/compact`, `/new`, `/resume`, `/fork`, `/clone`,
`/name`, `/export`, `/model`, `/copy`) — see `packages/server/AGENTS.md`'s Agent subsystem section
for the full rationale (built-ins without an RPC equivalent, e.g. `/settings`/`/hotkeys`, have no
wire representation at all). Each resolves to the RPC's `payload` object directly (`DaemonClient`
unwraps `{type, requestId, payload}` responses to just `payload`), matching every other typed
method on this facade.

| Method | RPC |
|--------|-----|
| `send(prompt, opts?)` | `send_agent_prompt` |
| `run(prompt, opts?)` | alias for `send` |
| `interrupt()` | `interrupt_agent` |
| `steer(message, opts?)` | `steer_agent_request` — inject into a live turn (after current tool calls) |
| `followUp(message, opts?)` | `follow_up_agent_request` — queue for after the agent stops |
| `update(patch)` | `update_agent` (model/mode/thinking/features/title/labels) |
| `resume()` | `resume_agent` |
| `archive()` | `archive_agent` (soft-delete — keeps the record, can resume) |
| `delete()` | `delete_agent` (hard delete — no trace, cannot resume) |
| `onUpdate(handler)` | Subscribe to `agent_update` for this agent only |
| `timeline.fetch(opts?)` | `fetch_agent_timeline_request` — **one bounded page** (≤ `limit`, server default 200); refetch from `endCursor` while `hasNewer` to get the whole history |
| `timeline.subscribe(handler)` | Subscribe to `agent_stream` for this agent only |
| `sessionStats()` | `agent_session_stats_request` (`/session` — tokens/cost/context-window usage) |
| `compact(customInstructions?)` | `agent_compact_request` (`/compact`) |
| `newSession()` | `agent_new_session_request` (`/new`) |
| `switchSession(sessionPath)` | `agent_switch_session_request` (`/resume`) |
| `fork(entryId)` | `agent_fork_request` (`/fork`) |
| `forkMessages()` | `agent_fork_messages_request` (fork picker) |
| `clone()` | `agent_clone_request` (`/clone`) |
| `setSessionName(name)` | `agent_set_session_name_request` (`/name`) |
| `exportHtml(outputPath?)` | `agent_export_html_request` (`/export`) |
| `setModel(provider, modelId)` | `agent_set_model_request` (`/model` set) |
| `cycleModel()` | `agent_cycle_model_request` (`/model` cycle) |
| `lastAssistantText()` | `agent_last_assistant_text_request` (`/copy`) |
| `listCommands()` | `agent_list_commands_request` (sprint-040 — command discovery: extension commands, prompt templates, skills from Pi's `get_commands`; disjoint from the sprint-037 slash commands above, no Pi built-in equivalent) |

### `PiStudioProviderActions` (from `providers`)

| Method | RPC | Return |
|--------|-----|--------|
| `listProviders()` | `list_providers` | `unknown` |
| `listModels(provider)` | `list_provider_models` | `Promise<ListProviderModelsResponse>` (sprint-043 — daemon handler in both bootstraps calls `AgentClient.listModels`, no spawned agent) |
| `listModes(provider)` | `list_provider_modes` | `unknown` (no daemon handler registered yet) |
| `refreshSnapshot()` | `providers.snapshot.refresh.request` (one of the rare dotted-name RPCs — see root `AGENTS.md` § Protocol overview) | `unknown` (no daemon handler registered yet) |

`ListProviderModelsResponse` (`{ type, requestId, provider, models: ProviderModel[] }`) and
`ProviderModel` (`{ id, label?, description?, provider? }`) are exported from `pistudio-client.ts`.
`ProviderModel.provider` is the model's OWN underlying LLM provider (e.g. `"anthropic"`, threaded
through from Pi's `Model` object) — REQUIRED by `AgentHandle.setModel(provider, modelId)`'s
`provider` argument, and a completely different value from `ListProviderModelsResponse.provider`
above (the pi-studio `AgentClient` id). Conflating the two was a real shipped bug: passing `"pi"`
to `setModel` made every `agent_set_model_request` fail server-side with `"Model not found:
pi/<modelId>"`. Like the RPC itself, both types exist only in this package — no `packages/protocol`
schema backs them, matching `list_providers`/`list_agents_request`'s untyped-ad-hoc-RPC convention.

### `importAgentSession(daemon, args)` (named export)

Sends `import_agent_session` RPC — not agent-scoped.

---

## `ReconnectionManager` (`reconnect.ts`)

Drives automatic reconnect after socket drop:

- Exponential backoff with configurable `initialDelayMs`, `maxDelayMs`, `factor`, `jitter`,
  `maxAttempts` (default `Infinity`).
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

Demuxes inbound binary terminal frames by `slot` to per-slot callback sets, and encodes outbound
input/resize:

```ts
const router = new TerminalStreamRouter(daemonClient);
router.start();                                   // begin routing (idempotent)
const unsub = router.subscribeSlot(slot, {
  onOutput: (data) => { … },                      // opcode Output
  onSnapshot: (data) => { … },                     // opcode Snapshot (sent on (re)subscribe)
  onRestore: (data) => { … },                      // opcode Restore (reflowable/mode-gated)
});
router.hasSlot(slot);                             // true iff a subscriber is registered
router.sendInput(slot, bytes);                    // opcode Input = 0x02
router.sendResize(slot, rows, cols);              // opcode Resize = 0x03
router.stop();                                    // stop routing; subscribers retained
```
A frame for a slot with no registered subscriber is silently dropped.

---

## `FileTransferClient` (`file-transfer-client.ts`)

Mirrors `TerminalStreamRouter`'s inbound-frame-routing shape, but a transfer is a one-shot
request/response rather than a persistent per-slot subscription:

```ts
const files = new FileTransferClient(daemonClient);
files.start();                                    // begin routing (idempotent)
const { bytes, fileName, mimeType } = await files.download(path);
// requests a single-use token, then the chunked transfer, assembling Begin → Chunk* → End
await files.upload(path, bytes);
// requests an upload stream (server keys it by a fresh transferId), then pushes
// Begin → Chunk* → End frames the server writes to `path` (creates parent dirs, overwrites
// any existing file — no confirmation server-side; callers must confirm before calling).
files.stop();                                     // stop routing; pending downloads are rejected
```

---

## Invariants

- **`RpcTimeoutError` must NOT close the socket.** It is an operation-level failure.
- **`clientId` must be stable** across reconnects (same session identity).
- **`hello` is re-sent on every `connect()` call**, including reconnects — `DaemonClient` always
  sends the same capabilities map so reconnect rehydrates them transparently.
- **`createRelayTransport` supports `sendBinary()`.** Terminal I/O and file-transfer chunks work
  over relay via the channel's `e2ee_bin` frame (a base64-wrapped JSON text frame, not raw binary
  WebSocket — see `@av-pi-studio/relay`'s README § Wire protocol); `DaemonClient.onTerminalFrame`/
  `onFileTransferFrame` receive them identically regardless of transport.
- **`createRelayTransport` always generates a FRESH ephemeral keypair per channel** — never reuse
  one across connections; only the daemon's public key (from the pairing offer) is persistent. The
  rendezvous **session id** is a separate, non-secret routing label — deterministic by default
  (`deriveRelaySessionId(daemonPublicKey)`), unlike the keypair — so it staying the same across
  reconnects does NOT weaken "new session → new keys" (architecture/relay-e2ee.md § Error
  Handling): the shared key still comes from the fresh ephemeral keypair, never from the session id.
- **`randomId()`** (exported from `daemon-client.ts`) is the one portable id generator for both RPC
  `requestId`s and `FileTransferClient.upload()`'s `transferId` — `crypto.randomUUID` where
  available, else a `Date.now()`+`Math.random()` fallback. `crypto.randomUUID` requires a secure
  context and is NOT guaranteed present in every browser/webview the client runs in (regression
  hit in practice: an insecure-context web-client build threw `crypto.randomUUID is not a
  function` on upload) — never call `crypto.randomUUID()` directly in this package; use
  `randomId()`.

---

## Testing

```bash
npx vitest run packages/client
```

Tests inject stub `Transport` implementations and mock clocks; they do not open real sockets.
