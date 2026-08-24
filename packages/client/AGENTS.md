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
7. **Extension UI SDK** (`agent-ui-state.ts` + `agent-ui-controller.ts`, sprint-067) — the client
   consumer of the daemon's `agent_ui_*` wire family (sprint-066): a pure reducer/selectors module
   (including resolved-dialog retention and in-flight submission tracking, sprint-067/task-005)
   plus a controller wiring layer over `PiStudioClient`. **Nothing in this repo renders it yet** —
   see § Extension UI below.

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
  pistudio-client.ts          PiStudioClient — high-level SDK facade + agent/workspace/provider handles + Extension UI SDK surface.
  pistudio-client.test.ts
  agent-ui-state.ts           Pure Extension UI reducer/selectors + resolved-dialog retention (sprint-067) — no DOM, no I/O, no timers.
  agent-ui-state.test.ts
  agent-ui-controller.ts      AgentUiController — subscribe-then-list rehydration, reconnect resync, agent-lifecycle pruning.
  agent-ui-controller.test.ts
  test-support/
    scripted-daemon.ts        makeScriptedDaemon()/makeFacade() — shared fake-transport harness for pistudio-client.test.ts and agent-ui-controller.test.ts.
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
  connect(url: string): Promise<void>; // resolves once the raw connection is open (pre-handshake)
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

| Method                                  | Description                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `connect()`                             | Open the transport, complete the `hello`→`server_info` handshake. Resolves with the `ServerInfoPayload`. |
| `close(code?, reason?)`                 | Close the transport. There is no separate `disconnect()`.                                                |
| `request<T>(type, params?, timeoutMs?)` | Send a session RPC, await correlated response. Rejects with `RpcError` or `RpcTimeoutError`.             |
| `sendSession(message)`                  | Fire-and-forget session message (wrapped in a `session` envelope) — no response awaited.                 |
| `sendBinary(data)`                      | Send a raw binary frame (terminal/file-transfer) via the transport.                                      |
| `ping(timeoutMs?)`                      | Send a JSON `ping`, await the correlated `pong` (NOT RFC 6455 ping).                                     |
| `hasFeature(flag)`                      | `true` iff the last `server_info.features.<flag>` was truthy.                                            |
| `onSessionMessage(handler)`             | Subscribe to all inbound session messages. Returns unsubscribe fn.                                       |
| `onTerminalFrame(handler)`              | Subscribe to decoded inbound terminal binary frames. Returns unsubscribe fn.                             |
| `onFileTransferFrame(handler)`          | Subscribe to decoded inbound file-transfer binary frames. Returns unsubscribe fn.                        |
| `onStateChange(handler)`                | Subscribe to connection state transitions. Returns unsubscribe fn.                                       |
| `state`                                 | Current `ConnectionState`                                                                                |
| `serverId`                              | Server identity from the last `server_info`                                                              |
| `features`                              | Feature flags map from the last `server_info`                                                            |
| `serverCapabilities`                    | Capability map from the last `server_info`                                                               |

### Error types

| Class             | When                                                          |
| ----------------- | ------------------------------------------------------------- |
| `RpcError`        | Server replied with `rpc_error` for the correlated request    |
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

| Method                        | Returns                          | Description                                                                                                     |
| ----------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `createAgent(req)`            | `Promise<{ agentId, … }>`        | `create_agent_request` RPC                                                                                      |
| `agent(agentId)`              | `PiStudioAgentActions`           | Scoped handle for an existing agent                                                                             |
| `workspace(workspaceId)`      | `PiStudioWorkspaceActions`       | Scoped handle for a workspace                                                                                   |
| `providers`                   | `PiStudioProviderActions`        | List providers/models/modes, refresh snapshot                                                                   |
| `onAgentUpdate(handler)`      | unsubscribe fn                   | Subscribe to all `agent_update` broadcasts                                                                      |
| `onWorkspaceUpdate(handler)`  | unsubscribe fn                   | Subscribe to all `workspace_update` broadcasts                                                                  |
| `listProviderAuth()`          | `Promise<ProviderAuthEntry[]>`   | `provider_auth_list_request` RPC                                                                                |
| `loginProvider(p, t, cb, o)`  | `Promise<{ ok, error? }>`        | Drives one login flow (see below)                                                                               |
| `logoutProvider(provider)`    | `Promise<{ stillConfigured }>`   | `provider_auth_logout_request` RPC                                                                              |
| `hasProviderAuthCapability()` | `boolean`                        | Whether the daemon advertised `providerAuth`                                                                    |
| `onAgentUiRequest(handler)`   | unsubscribe fn                   | Subscribe to `agent_ui_request` broadcasts (sprint-067, see § Extension UI)                                     |
| `onAgentUiResolved(handler)`  | unsubscribe fn                   | Subscribe to `agent_ui_resolved` broadcasts                                                                     |
| `respondToUi(id, response)`   | `Promise<AgentUiRespondResult>`  | `agent_ui_respond_request` RPC — returns, never throws, on a domain `not_found`/`unsupported`                   |
| `listAgentUi(agentId?)`       | `Promise<{ pending, surfaces }>` | `agent_ui_list_request` RPC — throws `AgentUiError` on failure                                                  |
| `extensionUiAvailable()`      | `boolean`                        | Whether the daemon advertised `extensionUi` — **not** `supportsExtensionUi()`, a different, provider-level flag |
| `connection`                  | `DaemonClient`                   | Escape hatch to the underlying driver                                                                           |

### `PiStudioAgentActions` (from `agent(id)`)

`sessionStats()` through `lastAssistantText()` (sprint-037) mirror Pi built-in slash commands that
have a real Pi RPC equivalent (`/session`, `/compact`, `/new`, `/resume`, `/fork`, `/clone`,
`/name`, `/export`, `/model`, `/copy`) — see `packages/server/AGENTS.md`'s Agent subsystem section
for the full rationale (built-ins without an RPC equivalent, e.g. `/settings`/`/hotkeys`, have no
wire representation at all). Each resolves to the RPC's `payload` object directly (`DaemonClient`
unwraps `{type, requestId, payload}` responses to just `payload`), matching every other typed
method on this facade.

| Method                         | RPC                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send(prompt, opts?)`          | `send_agent_prompt`                                                                                                                                                                                                 |
| `run(prompt, opts?)`           | alias for `send`                                                                                                                                                                                                    |
| `interrupt()`                  | `interrupt_agent`                                                                                                                                                                                                   |
| `steer(message, opts?)`        | `steer_agent_request` — inject into a live turn (after current tool calls)                                                                                                                                          |
| `followUp(message, opts?)`     | `follow_up_agent_request` — queue for after the agent stops                                                                                                                                                         |
| `update(patch)`                | `update_agent` (model/mode/thinking/features/title/labels)                                                                                                                                                          |
| `resume()`                     | `resume_agent`                                                                                                                                                                                                      |
| `archive()`                    | `archive_agent` (soft-delete — keeps the record, can resume)                                                                                                                                                        |
| `delete()`                     | `delete_agent` (hard delete — no trace, cannot resume)                                                                                                                                                              |
| `onUpdate(handler)`            | Subscribe to `agent_update` for this agent only                                                                                                                                                                     |
| `timeline.fetch(opts?)`        | `fetch_agent_timeline_request` — **one bounded page** (≤ `limit`, server default 200); refetch from `endCursor` while `hasNewer` to get the whole history                                                           |
| `timeline.subscribe(handler)`  | Subscribe to `agent_stream` for this agent only — `handler(event, meta)`, `meta.timestamp`/`meta.seq` forward the daemon-stamped row metadata alongside the event                                                   |
| `sessionStats()`               | `agent_session_stats_request` (`/session` — tokens/cost/context-window usage)                                                                                                                                       |
| `compact(customInstructions?)` | `agent_compact_request` (`/compact`)                                                                                                                                                                                |
| `newSession()`                 | `agent_new_session_request` (`/new`)                                                                                                                                                                                |
| `switchSession(sessionPath)`   | `agent_switch_session_request` (`/resume`)                                                                                                                                                                          |
| `fork(entryId)`                | `agent_fork_request` (`/fork`)                                                                                                                                                                                      |
| `forkMessages()`               | `agent_fork_messages_request` (fork picker)                                                                                                                                                                         |
| `clone()`                      | `agent_clone_request` (`/clone`)                                                                                                                                                                                    |
| `setSessionName(name)`         | `agent_set_session_name_request` (`/name`)                                                                                                                                                                          |
| `exportHtml(outputPath?)`      | `agent_export_html_request` (`/export`)                                                                                                                                                                             |
| `setModel(provider, modelId)`  | `agent_set_model_request` (`/model` set)                                                                                                                                                                            |
| `cycleModel()`                 | `agent_cycle_model_request` (`/model` cycle)                                                                                                                                                                        |
| `lastAssistantText()`          | `agent_last_assistant_text_request` (`/copy`)                                                                                                                                                                       |
| `listCommands()`               | `agent_list_commands_request` (sprint-040 — command discovery: extension commands, prompt templates, skills from Pi's `get_commands`; disjoint from the sprint-037 slash commands above, no Pi built-in equivalent) |
| `setThinking(level)`           | `agent_set_thinking_request` (sprint-070 — resolves to the EFFECTIVE, possibly Pi-clamped level; gate on the `thinkingLevels` server feature flag) |
| `listThinkingLevels()`         | `agent_thinking_levels_request` (sprint-070 — live sessions only; drafts read the model catalogue) |

### `PiStudioProviderActions` (from `providers`)

| Method                 | RPC                                                                                                                | Return                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `listProviders()`      | `list_providers`                                                                                                   | `unknown`                                                                                                                               |
| `listModels(provider)` | `list_provider_models`                                                                                             | `Promise<ListProviderModelsResponse>` (sprint-043 — daemon handler in both bootstraps calls `AgentClient.listModels`, no spawned agent) |
| `listModes(provider)`  | `list_provider_modes`                                                                                              | `unknown` (no daemon handler registered yet)                                                                                            |
| `refreshSnapshot()`    | `providers.snapshot.refresh.request` (one of the rare dotted-name RPCs — see root `AGENTS.md` § Protocol overview) | `unknown` (no daemon handler registered yet)                                                                                            |

`ListProviderModelsResponse` (`{ type, requestId, provider, models: ProviderModel[] }`) and
`ProviderModel` (`{ id, label?, description?, provider? }`) are exported from `pistudio-client.ts`.
`ProviderModel.provider` is the model's OWN underlying LLM provider (e.g. `"anthropic"`, threaded
through from Pi's `Model` object) — REQUIRED by `AgentHandle.setModel(provider, modelId)`'s
`provider` argument, and a completely different value from `ListProviderModelsResponse.provider`
above (the pi-studio `AgentClient` id). Conflating the two was a real shipped bug: passing `"pi"`
to `setModel` made every `agent_set_model_request` fail server-side with `"Model not found:
pi/<modelId>"`. Since sprint-070 `ProviderModel` also carries optional `reasoning` +
`thinkingLevels` (the Pi adapter's per-model derivation) so a draft's thinking selector can offer
the right levels with no live session, and `ResolveDefaultModelResponse` carries optional
`thinkingLevel` (the `--no-session get_state`'s fresh default). Like the RPC itself, both types
exist only in this package — no `packages/protocol` schema backs them, matching
`list_providers`/`list_agents_request`'s untyped-ad-hoc-RPC convention.

### Provider auth (`loginProvider`, sprint-065)

`loginProvider(provider, authType, callbacks, opts?)` drives one Pi login flow over the
`provider_auth_*` RPC family, hiding flowId/promptId correlation. Only one flow may be active per
client; a second call rejects locally without sending anything. Key behaviours, each of which has a
regression test in `pistudio-client.test.ts`:

- **Subscribes before requesting.** The daemon starts Pi's flow while handling the login request, so
  an `auth_url` or `prompt` can arrive before the response carrying `flowId` is processed. Events are
  buffered until the flowId is known — written the natural way (await, then subscribe) the first
  prompt is silently dropped and the caller waits forever.
- **`callbacks.prompt(prompt)`** returns the answer; `callbacks.onEvent(event)` receives the
  `notify`-sourced events (`info`/`auth_url`/`device_code`/`progress`, plus unknown future kinds).
  `prompt`, `prompt_cancelled` and `done` are consumed by this driver and never reach `onEvent`.
- **`ProviderAuthPromptUi.signal` aborts when that prompt is retired** — the callback-wins race, or
  the flow ending. This is the _only_ notice a view gets: `prompt_cancelled` rejects the driver's
  internal race and the promise the view returned is discarded, so nothing else tells it the
  question is gone. A view that ignores it leaves a dead `manual_code` input on screen (real bug,
  fixed in sprint-065/task-005).
- **`opts.signal`** cancels the whole flow server-side; a socket drop settles
  `{ ok: false, error: "connection_lost" }` rather than hanging; events for a stale flowId are
  dropped; every subscription is released exactly once when the flow settles. This guarantee used
  to have a gap: a `respond`/`provider_auth_respond_request` RPC that timed out (the daemon peer
  unreachable but the client's own socket never closing — e.g. the daemon dying behind a relay,
  where the client's WS to the relay itself stays open) left `handleProviderAuthPrompt`'s catch
  block firing a best-effort `provider_auth_cancel_request` and swallowing the outcome, never
  calling `settleProviderAuthFlow` — the dialog hung forever with no error, discovered live during
  sprint-065/task-007's relay-path kill-mid-flow verification. Fixed: that catch now settles
  `{ ok: false, error: "connection_lost" }` unconditionally (the best-effort cancel still fires
  alongside, but the flow's own promise no longer waits on it). Bound by `rpcTimeoutMs` either
  way — `web-client`'s `connection-store.ts` sets it to 30 minutes app-wide (one value shared with
  agent turns), so a relay-mediated daemon death is _correctly_ reported now, just not _quickly_;
  the relay protocol has no peer-liveness signal for the client to react to sooner
  (`@av-pi-studio/relay`'s `RelaySessionBridge` only logs `onUnregister` server-side, it never
  forwards a "peer left" frame to the remaining peer) — a real gap, but a relay-protocol design
  question outside a login-dialog bug fix's scope.

### `importAgentSession(daemon, args)` (named export)

Sends `import_agent_session` RPC — not agent-scoped.

### Extension UI facade surface (`agent_ui_*`, sprint-067)

Consumes the daemon's `agent_ui_*` wire family (sprint-066, `swe/features/extension-ui-rpc.md`) —
the five members in the table above, plus supporting types/guards, all on `pistudio-client.ts`:

- **`AgentUiEventMeta`** — `{ receivedAt: number }`, a **local** clock reading stamped by the SDK
  when `onAgentUiRequest` delivers a push. Deliberately unlike `AgentStreamEventMeta`'s daemon
  `timestamp`/`seq`: the daemon may run on another host, and `receivedAt` exists specifically so
  the reducer's timeout display can reason about cross-host clock skew instead of trusting it.
- **Error convention splits, deliberately.** `respondToUi` _returns_ `AgentUiRespondResult`
  (`{ ok: true } | { ok: false, reason }`) — a `not_found` (another client answered first) is the
  _normal_ outcome of a multi-client broadcast race, not exceptional. `listAgentUi` _throws_
  `AgentUiError` — a failed snapshot has no benign meaning. `reason`/the error message forward the
  daemon's string **verbatim**, never relabelled (`not_found` covers answered-elsewhere, a bogus
  id, and an already-swept agent alike — the client has no way to distinguish them and must not
  assert it does).
- **Four guards**, exported: `isAgentUiRequest`/`isAgentUiResolved` narrow the two subscriptions
  (mirrors `isProviderAuthFlowEvent`'s structural-check style). `isAgentArchived`/`isAgentDeleted`
  narrow the **real** `sessionMessageSchema` union members `agent_archived`/`agent_deleted` — **not**
  part of the `agent_ui_*` family, but exported here because `agent-ui-controller.ts` needs them for
  pruning (see below) and a third narrowing copy in a future renderer is worth pre-empting.
  **Deliberately not `onAgentUpdate`**: `AgentManager.archiveAgent`/`deleteAgent`
  (`packages/server`) call `broadcastArchived`/`broadcastDeleted` exclusively and never the
  `agent_update`-emitting path, so `onAgentUpdate` (which filters `type === "agent_update"`) can
  never see an archive or delete — verified against source, not assumed.
- **`extensionUiAvailable()` is deliberately not named `supportsExtensionUi()`** — that name is
  already the _provider_ capability flag (`protocol/src/provider-manifest.ts`, "this provider
  forwards UI events to the daemon"), a different question from "does this daemon speak the
  `agent_ui_*` RPC family at all."

## Extension UI state + controller (`agent-ui-state.ts` + `agent-ui-controller.ts`, sprint-067)

The client-side consumer of the family above. **Nothing in this repo renders any of it yet** —
this is infrastructure only; a sibling scope owns rendering. Two modules, split on purity:

**`agent-ui-state.ts` — pure, no DOM/timers/I/O/logging.** `reduce(state, action) → { state,
effects }`; every transition returns a new `AgentUiState` (`{ pending, surfaces, resolved }`, all
`Record`s) and a list of effects to _perform elsewhere_, never performs them itself.

- **Routing is by wire predicate, never a `method` table**: `expectsResponse` → dialog;
  `surfaceKey && removed` → delete a surface; `surfaceKey` → upsert a surface; otherwise →
  transient (`method` matters only _within_ the transient category, to pick `notify` vs
  `set_editor_text`). An unrecognised dialog method still enters `pending` (method verbatim, no
  unknown flag — dropping it would wedge the agent's turn); an unrecognised transient produces
  **zero** effects, which is itself the "unknown method" signal the controller reports.
- **`snapshot` replaces `pending`/`surfaces` wholesale, never merges** — the daemon composes it
  from state that postdates every broadcast already sent on the one ordered socket, so it is
  authoritative. `resolved` passes through untouched instead (see below — the daemon has nothing
  to re-serve there). `disconnected` sets every pending entry `answerable: false`; only a following
  `snapshot` sets it back `true` (a one-way door without that round-trip).
- **Timeouts are displayed, never acted on.** `remainingMs(entry, now)` is a pure countdown; no
  action anywhere in this module dismisses/expires an entry — only a real `ui_resolved` moves one
  from `pending` to `resolved` (Pi auto-resolves its own timed dialogs; two clients racing
  independent expiry logic would diverge from each other and from the agent).
- **Resolved dialogs are retained, not discarded** (sprint-067/task-005): `ui_resolved` moves the
  entry into `resolved` (keyed by `requestId`, same as `pending`) instead of deleting it — a
  resolved card collapses in place and stays for the life of the page, at its **original**
  `createdAt` (no `resolvedAt` field exists), so merging `pendingForAgent`/`resolvedForAgent` by
  that key never reshuffles a list when one entry resolves. `resolved` is page-lifetime state: it
  survives `snapshot`/`disconnected` (the daemon has no resolved history to re-serve, unlike
  `pending`) and is dropped only by `agent_removed` or a page reload. Bounded per agent by
  `RESOLVED_HISTORY_LIMIT` (`50`) — insertion past the cap evicts that agent's oldest entry by the
  same `createdAt`/`requestId` ordering the selectors use; other agents are never touched by one
  agent's eviction.
- **`respond_sent`/`respond_failed` track an in-flight `respond` for the pressed-control spinner**
  (task-005) — `respond_sent` sets `pending[id].submitting: true` (and `submittedAnswer`, see
  below); the entry stays in `pending` throughout — only `ui_resolved` ever resolves it, never a
  successful RPC by itself (no optimistic resolution). `respond_failed` clears `submitting`/
  `submittedAnswer` on a still-pending entry — this is what stops a lost first-answer-wins race
  (an RPC that resolves `{ ok: false }`) from leaving a spinner running forever, since a
  `not_found` response is followed by no broadcast to the losing client.
- **`select`/`confirm` answers are retained for display; `input`/`editor` answers never are — a
  storage rule, not routing** (the module's one other `method` read, alongside the transient-effect
  switch). `input`/`editor` resolve to free text the user typed, and an extension asking for a
  secret (an API token, say) is an expected, documented case, so the submitted value must be
  **unrepresentable** in this module's state for those two methods — not merely unrendered by
  convention. `submittedAnswer`/`resolved[id].answer` (`{ value?, confirmed? }`) are populated only
  for `select`/`confirm`; every other method (including unrecognised ones) leaves both fields
  entirely absent, not merely empty.
- Selectors (`pendingForAgent`, `pendingByAgent`, `surfacesForAgent`, `resolvedForAgent`,
  `remainingMs`) are all pure and stably ordered. `resolvedForAgent` uses the same
  `createdAt`/`requestId` comparator as `pendingForAgent`, by design (see the merge property above).

**`agent-ui-controller.ts` — the impure wiring layer**, `createAgentUiController(client, opts?) →
{ getState, subscribe, respond, resync, dispose }`. Owns everything a consumer would otherwise get
wrong:

- **Subscribe-then-list rehydration**: attaches `onAgentUiRequest`/`onAgentUiResolved` (queueing
  while a `listAgentUi()` is in flight) before ever calling `listAgentUi()`. On the response:
  dispatch `snapshot`, **discard** every queued dialog/surface event (already reflected in the
  snapshot by ordered-delivery), **replay** only queued transients (genuinely new — nothing retains
  them).
- **Automatic reconnect, never left to the consumer** — subscribes to `client.connection.onStateChange`
  itself; `"open"` re-triggers `resync()` (re-checking `extensionUiAvailable()`, since the daemon
  may have been upgraded). A generation counter guards overlapping `resync()` calls: only the
  response matching the latest attempt commits.
- **Agent-lifecycle pruning off `agent_archived`/`agent_deleted`** (via `isAgentArchived`/
  `isAgentDeleted` above), never `onAgentUpdate` — see those guards' own note.
- **`respond` dispatches `respond_sent` before the RPC, `respond_failed` only on a domain failure**
  (task-005) — still no optimistic _resolution_: the entry leaves `pending` only when a real
  `agent_ui_resolved` broadcast arrives, but `submitting` flips synchronously so a pressed control
  can render a spinner immediately, before the round-trip completes.

Tests: `agent-ui-state.test.ts` (pure, no jsdom), `agent-ui-controller.test.ts` (against
`test-support/scripted-daemon.ts`'s shared harness), plus a cross-package E2E against a **real**
dev daemon over a real WebSocket in `packages/cli/src/agent-ui-sdk-e2e.test.ts` (sprint-067/
task-004 — lives in `cli` because `client` and `server` have no dependency edge in either
direction; `cli` is the only package that already depends on both).

---

## `ReconnectionManager` (`reconnect.ts`)

Drives automatic reconnect after socket drop:

- Exponential backoff with configurable `initialDelayMs`, `maxDelayMs`, `factor`, `jitter`,
  `maxAttempts` (default `Infinity`).
- On each attempt: calls `daemonClient.connect()` which re-issues the full `hello` handshake.
- Fires `onReconnected(handler)` after success; `onReconnectFailed(handler)` on error.
- All timer/RNG dependencies are injectable for deterministic tests (`web-client`'s
  `connection-store.ts` injects Worker-backed timers — sprint-050 — so backoff scheduling keeps
  accuracy in a hidden/throttled tab).
- `reconnectNow()` (sprint-050) — cancel any pending backoff timer and attempt a reconnect
  immediately, resetting the attempt counter to 0 first. No-op unless `start()`ed and not already
  `stop()`ed, no-op while a reconnect attempt is in flight, no-op unless the daemon is currently
  `closed` (covers `open`/`connecting`/`closing`/`idle` in one guard). A successful forced
  reconnect notifies `onReconnected` with `attempt: 0` — the convention that distinguishes it from
  a ladder attempt (always ≥ 1). A forced attempt that fails re-enters the normal failure path,
  which restarts the ladder at rung 1. Exists so an external resume signal (tab became visible, OS
  reports network back — see `web-client`'s `lib/connection/resume-triggers.ts`) can bypass a
  throttled backoff delay. `scheduleReconnect()` is single-armed (at most one pending timer at a
  time) so `reconnectNow()`'s `clearTimer` call is always authoritative.

```ts
const mgr = new ReconnectionManager(daemonClient, opts);
mgr.onReconnected(({ attempt, serverId }) => { … }); // attempt === 0 → forced via reconnectNow()
mgr.start();         // arm; auto-reconnects on state → "closed"
mgr.reconnectNow();  // bypass the pending backoff delay and retry now
mgr.stop();          // disarm
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
files.start(); // begin routing (idempotent)
const { bytes, fileName, mimeType } = await files.download(path);
// requests a single-use token, then the chunked transfer, assembling Begin → Chunk* → End
await files.upload(path, bytes);
// requests an upload stream (server keys it by a fresh transferId), then pushes
// Begin → Chunk* → End frames the server writes to `path` (creates parent dirs, overwrites
// any existing file — no confirmation server-side; callers must confirm before calling).
files.stop(); // stop routing; pending downloads are rejected
```

- **Stream ids come from the protocol's shared pool** (`nextFreeSlot`/`SLOT_SPACE`) and are
  recycled when a transfer ends — including when its request rejects, which streams no `End`.
  The frame header spends one byte on the id, so the old `nextStream++` emitted 256 on the 256th
  download of a connection and every download after that died in the codec.
- **`download()` retries exactly once on `invalid_or_expired_token`.** The daemon's TTL runs from
  the moment it issues a token, but the token is only usable once its response has crossed a
  socket shared with every in-flight `Chunk` frame — a large transfer ahead of it can deliver a
  token that is already dead (routine over relay). By the time the rejection arrives that backlog
  has drained, so one clean attempt suffices; further looping would only spin on a broken link.

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
npx vitest run packages/cli/src/agent-ui-sdk-e2e.test.ts   # cross-package Extension UI E2E (real daemon)
```

Tests inject stub `Transport` implementations and mock clocks; they do not open real sockets —
with one exception: `packages/cli/src/agent-ui-sdk-e2e.test.ts` (sprint-067/task-004) drives a
real `PiStudioClient`/`AgentUiController` over a real WebSocket against a real dev daemon
(`@av-pi-studio/server`'s `startDevDaemon`), proving interoperability beyond this package's own
scripted-transport tests. It lives in `cli`, not here, because `client` and `server` have no
dependency edge in either direction.
