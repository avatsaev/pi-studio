# `@av-pi-studio/protocol` — AGENTS.md

Shared wire schemas, binary frame codecs, and capability flags.
This package is the **single source of truth for everything that crosses the WebSocket**.

---

## Purpose

`protocol` is a **zero-runtime-workspace-dep** library consumed by every other package in the
monorepo — including future browser and React Native clients. It must stay dependency-free except
for `zod`. Never import from another `@av-pi-studio/*` package here.

---

## Source layout

```
src/
  index.ts                                Public barrel — re-exports everything below.
  messages.ts                             All JSON wire schemas (Zod) + top-level envelope union.
  client-capabilities.ts                  CLIENT_CAPS / SERVER_FEATURES flags + supports() helper.
  provider-manifest.ts                    Provider / mode manifest types (UI scaffolding).
  endpoint.ts                             Daemon endpoint / host string parser.
  validation.ts                           Shared base primitives: uuidSchema, isoTimestampSchema, COMPAT().
  binary-frames/
    index.ts                              Re-exports both binary codecs + the slot allocator.
    terminal-stream-protocol.ts           Terminal binary frame codec (opcode+slot framing).
    terminal-stream-protocol.test.ts
    file-transfer-protocol.ts             File download/upload binary frame codec.
    file-transfer-protocol.test.ts
    slots.ts                              Shared 0–255 slot/stream id allocation for both codecs.
    slots.test.ts
  messages.envelopes.test.ts              Envelope round-trip tests.
  client-capabilities.test.ts
  endpoint.test.ts
  harness.test.ts
  provider-manifest.test.ts
  session-messages.test.ts
  validation.test.ts
```

---

## Key exports

### `messages.ts` — JSON wire protocol

| Export | Kind | Purpose |
|--------|------|---------|
| `clientTypeSchema` / `ClientType` | schema + type | `"mobile" \| "browser" \| "cli" \| "mcp"` |
| `helloSchema` / `Hello` | Zod schema + type | Client→Server first frame (clientId, clientType, protocolVersion, capabilities) |
| `statusSchema` / `Status` | schema + type | Server→Client `server_info` wrapper after handshake |
| `serverInfoPayloadSchema` / `ServerInfoPayload` | schema + type | Payload inside `status` (serverId, hostname, version, capabilities, features) |
| `pingSchema` / `Ping` | schema + type | JSON liveness ping (Client→Server) |
| `pongSchema` / `Pong` | schema + type | JSON liveness pong (Server→Client) |
| `createAgentRequestSchema` / `CreateAgentRequest` | schema + type | Create-or-run-agent RPC request |
| `createAgentResponseSchema` / `CreateAgentResponse` | schema + type | Response with `agentId` |
| `agentSessionConfigSchema` / `AgentSessionConfig` | schema + type | Provider/model/mode/run options |
| `agentUpdateSchema` | schema | Broadcast: agent status/title/labels changed |
| `agentStatusMessageSchema` | schema | Broadcast: bare agent status transition |
| `agentListSchema` | schema | Broadcast/response: agent listing |
| `agentDeletedSchema` | schema | Broadcast: agent hard-deleted |
| `agentArchivedSchema` | schema | Broadcast: agent archived (soft delete) |
| `agentStreamSchema` | schema | Broadcast: live agent turn event |
| `agentStreamEventSchema` / `AgentStreamEvent` | discriminated union | Turn events: user_message (optional `images`), assistant_message (optional `final` — see below), reasoning (same optional `final`), tool_call, turn_started/completed/failed/canceled, error, `queue_update` (`steering[]`/`followUp[]` — pending steering/follow-up queue changed) |
| `imageAttachmentSchema` / `ImageAttachment` | schema + type | User-message image attachment wire shape `{ mimeType?, data? }` (base64); provider adapters convert to their native prompt-image format |
| `toolCallDetailSchema` / `ToolCallDetail` | discriminated union | Tool detail normalized across providers (shell/read/edit/write/search/fetch/task) |
| `fetchAgentTimelineRequestSchema` | schema | Paged timeline fetch RPC |
| `fetchAgentTimelineResponseSchema` / `FetchAgentTimelineResponse` | schema + type | Paged timeline response (items, cursors, seq ranges) |
| `agentPermissionRequestSchema` | schema | Daemon→Client tool-call permission request |
| `agentPermissionResolvedSchema` | schema | Broadcast: a permission request was resolved (by any client) |
| `respondToPermissionRequestSchema` | schema | Client→Daemon permission response (dotted name `agent.permission.respond.request`) |
| `respondToPermissionResponseSchema` | schema | Response to the above |
| `legacyRespondToPermissionSchema` | schema | Accepted legacy flat name for the above |
| `rewindModeSchema` / `RewindMode` | schema + type | `"conversation" \| "files" \| "both"` |
| `agentRewindRequestSchema` / `AgentRewindRequest` | schema + type | `agent.rewind.request` — conversation/file time-travel |
| `agentRewindResponseSchema` / `AgentRewindResponse` | schema + type | Response, includes `truncatedAt` |
| `steerAgentRequestSchema` / `SteerAgentRequest` | schema + type | `steer_agent_request` — inject a message into a live turn (Pi `steer`); `agentId`, `message`, optional `images`/`clientMessageId` |
| `steerAgentResponseSchema` / `SteerAgentResponse` | schema + type | Response `{ agentId, ok }` (`ok:false` = no live turn) |
| `followUpAgentRequestSchema` / `FollowUpAgentRequest` | schema + type | `follow_up_agent_request` — queue a message delivered after the agent stops (Pi `follow_up`) |
| `followUpAgentResponseSchema` / `FollowUpAgentResponse` | schema + type | Response `{ agentId, ok }` |
| `agentSessionStatsResponseSchema` / `AgentSessionStatsResponse` | schema + type | `/session` response payload — tokens/cost/contextUsage, plus optional `model` (sprint-042: back-filled server-side from runtime info when the provider's own stats omit it, so a poll-driven client has a self-correcting model source) |
| `agentCommandDescriptorSchema` / `AgentCommandDescriptor` | schema + type | Discoverable command entry (sprint-040): `name` (required) + optional `id`/`description`/`source` (`extension`\|`prompt`\|`skill`)/`scope` (`user`\|`project`\|`temporary`)/`path` |
| `agentListCommandsRequestSchema` / `AgentListCommandsRequest` | schema + type | `agent_list_commands_request` — surfaces Pi's `get_commands` (extension commands, prompt templates, skills) for a live session; `{ agentId }` |
| `agentListCommandsResponseSchema` / `AgentListCommandsResponse` | schema + type | Response `{ payload: { commands: AgentCommandDescriptor[] } }` |
| `extensionPacksListRequestSchema` / `ExtensionPacksListRequest` | schema + type | `extension_packs_list_request` (sprint-057) — `{}`, read curated-pack state |
| `extensionPacksListResponseSchema` / `ExtensionPacksListResponse` | schema + type | Response: `autoSync`, `selected: string[]`, `packs: ExtensionPackInfo[]`, optional `lastSync: { at, outcome }` (a persisted **summary**, never the full report) |
| `extensionPacksSetRequestSchema` / `ExtensionPacksSetRequest` | schema + type | `extension_packs_set_request` — optional `packs?: string[]`; **absent** is the manual-sync trigger (no persistence, ungated), **present** replaces the selection then syncs |
| `extensionPacksSetResponseSchema` / `ExtensionPacksSetResponse` | schema + type | List-response fields plus `ok: boolean`, optional `error` (domain failure, e.g. unknown slug — never `rpc_error`), optional `report: ExtensionSyncReport` (present only when `ok: true`) |
| `extensionPackInfoSchema` / `ExtensionPackInfo`, `extensionEntryInfoSchema` / `ExtensionEntryInfo`, `extensionSyncReportSchema` / `ExtensionSyncReport` | schema + type | Nested shapes for the pair above; `status`/`outcome`/`reason` fields are plain `z.string()`, never narrowed enums (`EntryStatus`/`SyncOutcome` exported as documentation-only TS unions) — an older client must still parse a status value a later daemon introduces |
| `providerAuthTypeSchema` / `ProviderAuthType` | schema + type | `"api_key" \| "oauth"` |
| `providerAuthInfoSchema` / `ProviderAuthInfo` | schema + type | One provider's login capability + current state: `id`/`name`/`authTypes`, optional `oauthLoginLabel`/`oauthIsSubscription`, `configured: boolean \| "unknown"` (bounded probe timed out), optional `configuredType`/`configuredSource` |
| `providerAuthListRequestSchema` / `ProviderAuthListRequest`, `providerAuthListResponseSchema` / `ProviderAuthListResponse` | schema + type | `provider_auth_list_request` — list every login-capable provider with current auth state |
| `providerAuthLoginRequestSchema` / `ProviderAuthLoginRequest`, `providerAuthLoginResponseSchema` / `ProviderAuthLoginResponse` | schema + type | `provider_auth_login_request` (`provider`, `authType`) — starts a flow; response `{ ok, flowId?, error? }` returns immediately, before the login itself settles |
| `providerAuthRespondRequestSchema` / `ProviderAuthRespondRequest`, `providerAuthRespondResponseSchema` / `ProviderAuthRespondResponse` | schema + type | `provider_auth_respond_request` (`flowId`, `promptId`, `value`) — answers a pending prompt; `{ ok: false, error: "not_found" }` for an unknown/stale/not-owned flowId or promptId (never leaks which) |
| `providerAuthCancelRequestSchema` / `ProviderAuthCancelRequest`, `providerAuthCancelResponseSchema` / `ProviderAuthCancelResponse` | schema + type | `provider_auth_cancel_request` (`flowId`) — unconditionally idempotent, `{ ok: boolean }` only, **no `error` field on the wire** even for an unknown/not-owned flowId |
| `providerAuthLogoutRequestSchema` / `ProviderAuthLogoutRequest`, `providerAuthLogoutResponseSchema` / `ProviderAuthLogoutResponse` | schema + type | `provider_auth_logout_request` (`provider`) — response `{ ok, stillConfigured?, error? }`; `stillConfigured` flags an ambient credential (e.g. env var) surviving the logout |
| `agentUiPendingRequestSchema` / `AgentUiPendingRequest` | schema + type | One pending extension-UI dialog: `requestId` (daemon-minted), `agentId`, `method`, `expectsResponse`, `payload`, optional `surfaceKey`/`timeoutMs`, `createdAt` |
| `agentUiSurfaceSchema` / `AgentUiSurface` | schema + type | One retained, last-value-wins extension-UI surface (status/widget/title): `agentId`, `method`, `surfaceKey`, `payload`, `updatedAt` |
| `agentUiRequestSchema` / `AgentUiRequest` | schema + type | `agent_ui_request` — daemon→client broadcast, one per provider UI event (dialog or fire-and-forget); `payload` is opaque, never interpreted by the daemon |
| `agentUiResolvedSchema` / `AgentUiResolved` | schema + type | `agent_ui_resolved` — broadcast that a dialog is no longer answerable; `reason: "answered" \| "aborted" \| "timeout"` |
| `agentUiResponseSchema` / `AgentUiResponse` | schema + type | The answer body forwarded to the provider verbatim — every field optional/passthrough, no per-method shape validation (mirrors `respondToPermission`'s `response: unknown`) |
| `agentUiRespondRequestSchema` / `AgentUiRespondRequest`, `agentUiRespondResponseSchema` / `AgentUiRespondResponse` | schema + type | `agent_ui_respond_request` (`uiRequestId`, `response`) — answers a pending dialog; response `{ ok, error? }`, `error: "not_found" \| "unsupported"` (open string, not enumerated) |
| `agentUiListRequestSchema` / `AgentUiListRequest`, `agentUiListResponseSchema` / `AgentUiListResponse` | schema + type | `agent_ui_list_request` (optional `agentId`) — reconnect catch-up: current pending dialogs + retained surfaces, one agent or all |
| `agentSetThinkingRequestSchema` / `AgentSetThinkingRequest`, `agentSetThinkingResponseSchema` / `AgentSetThinkingResponse` | schema + type | `agent_set_thinking_request` (`agentId`, `level`) — sets the agent's thinking level; response resolves to the EFFECTIVE (possibly Pi-clamped) level, never the requested one |
| `agentThinkingLevelsRequestSchema` / `AgentThinkingLevelsRequest`, `agentThinkingLevelsResponseSchema` / `AgentThinkingLevelsResponse` | schema + type | `agent_thinking_levels_request` (`agentId`) — lists thinking levels for the agent's current model; live-sessions-only (drafts answer from the model catalogue client-side), gated by the `thinkingLevels` server feature flag |
| `rpcErrorSchema` / `RpcError` | schema + type | Correlated RPC error response |
| `sessionMessageSchema` / `SessionMessage` | discriminated union | All currently-defined session message types |
| `sessionMessageBaseSchema` / `SessionMessageBase` | schema + type | Structural fallback (`{ type: string }.passthrough()`) for any session message not yet in the union |
| `sessionEnvelopeSchema` / `SessionEnvelope` | schema + type | `{ type: "session", message }` top-level envelope |
| `topLevelEnvelopeSchema` / `TopLevelEnvelope` | discriminated union | hello \| status \| ping \| pong \| session |
| `rpcName(domain, sub, op, dir)` | function | Build a canonical dotted RPC name |
| `agentStatusEnum` / `AgentStatus` | enum | `initializing \| idle \| running \| error \| closed` |
| `wireTimestampSchema` / `WireTimestamp` | schema | `number \| ISO-8601 string` (never narrowed) |

**`assistant_message.final` / `reasoning.final` — block-close markers.** `assistant_message` and
`reasoning` are *deltas*: the daemon emits one per Pi `text_delta`/`thinking_delta` and the client
concatenates them into one row. `final: true` marks the event that closes the block (mapped from
Pi's `text_end`/`thinking_end` in `packages/server/src/agent/providers/pi/event-mapper.ts`), which
is the only in-band signal that the text will not grow. Live markers carry no `text` of their own;
restored history (`session-hydration.ts`) sets `final` alongside the block's full text, since a
persisted block is complete by definition. Renderers use it to leave their cheap streaming tier
(the web client swaps plain text for markdown here) instead of waiting for `turn_completed`, which
is one `agent_end` — an entire tool loop — away. Append-only-safe: a client that ignores `final`
sees a textless `assistant_message` and no-ops on it.

**`provider_auth_flow_event` — passthrough push, deliberately no union entry.** The per-flow
progress push for the `provider_auth_*` RPC family (`kind: "info" | "auth_url" | "device_code" |
"progress" | "prompt" | "prompt_cancelled" | "done"`, `flowId`, an event-shaped payload) rides
`sessionMessageBaseSchema`'s structural `{ type: string }.passthrough()` fallback, exactly like
`checkout_status_update` and `file_changed`. Do not "fix" this by adding a dedicated schema entry —
it is the established pattern for a per-session progress push that is not itself a durable,
multi-client RPC response.

**`agent_ui_*` — real union members, not a passthrough push.** Unlike every family above,
`agentUiRequestSchema`/`agentUiResolvedSchema`/`agentUiRespondRequestSchema`/`-ResponseSchema`/
`agentUiListRequestSchema`/`-ResponseSchema` are all registered directly in `sessionMessageSchema`'s
discriminated union (root `AGENTS.md`'s § Protocol overview). `payload` on `agentUiRequestSchema`/
`agentUiPendingRequestSchema` is intentionally `z.unknown()` (well, an untyped passthrough object) —
the daemon forwards whatever the provider adapter produced without validating per-method shape; only
the envelope fields (`requestId`, `agentId`, `method`, `expectsResponse`, optional `surfaceKey`/
`removed`/`timeoutMs`) are real schema.

### `client-capabilities.ts`

| Export | Description |
|--------|-------------|
| `CLIENT_CAPS` | `custom_mode_icons`, `reasoning_merge_enum`, `terminal_reflowable_snapshot`, `inline_image_markdown`, `file_link_markdown`, `mermaid_diagram_markdown` — flags the client advertises in `hello.capabilities` |
| `SERVER_FEATURES` | `providersSnapshot`, `checkoutGithubSetAutoMerge`, `daemonStatusRpc`, `terminal-restore-modes`, `rewind`, `checkoutRefresh`, `extensionPacks`, `providerAuth`, `extensionUi`, `thinkingLevels` — features the daemon advertises in `server_info.features` |
| `supports(caps, flag)` | Returns `true` iff `flag` is in `caps` (handles Set, array, object, undefined) |

### `binary-frames/terminal-stream-protocol.ts`

Binary frame layout: `[1-byte opcode][1-byte slot][payload]`.

| Export | Description |
|--------|-------------|
| `TerminalOpcode` | `Output=0x01, Input=0x02, Resize=0x03, Snapshot=0x04, Restore=0x05` |
| `TerminalFrame` | Discriminated union of decoded frames |
| `encodeTerminalFrame(frame)` | Encode a `TerminalFrame` → `Uint8Array` |
| `decodeTerminalFrame(bytes)` | Decode `Uint8Array` → `TerminalFrame` (throws `TerminalFrameError` on bad input) |

- `slot` (0–255) demuxes multiple terminals on one WebSocket.
- `Resize` payload is UTF-8 JSON `{ rows, cols }`.
- All other payloads are raw bytes (pass-through) — **except** `Restore`, whose payload is a
  `ScreenBuffer.serialize()` result (a redraw of the daemon's screen model), not a byte-ring replay
  (sprint-053/task-004). `Restore` is live and emitted, not reserved: a subscription negotiates it by
  requesting `restoreMode: "reflowable"` on `subscribe_terminal_request` while both
  `CLIENT_CAPS.terminal_reflowable_snapshot` (sent) and `SERVER_FEATURES["terminal-restore-modes"]`
  (advertised) hold; any other combination — including a request the daemon doesn't support — is
  served the basic `Snapshot` tier instead, and `SubscribeTerminalResponse.restoreMode` echoes
  whichever tier was actually served (`packages/server/AGENTS.md`'s Terminal subsystem section).
- Uses `Uint8Array` (not `Buffer`) — runs in browser/RN.

### `binary-frames/file-transfer-protocol.ts`

Binary framing for file download/upload operations. Frame layout `[1-byte opcode][1-byte stream][payload]`;
`stream` (0–255) multiplexes concurrent transfers on one socket.

### `binary-frames/slots.ts`

| Export | Description |
|--------|-------------|
| `SLOT_SPACE` | `256` — the one-byte slot/stream id space both binary codecs share |
| `nextFreeSlot(inUse, cursor?)` | Lowest free id at or after `cursor` (wrapping), or `null` when all 256 are live. `inUse` is any `Map`/`Set` of live ids |

Slot/stream ids are a **pool, not a counter**: every allocator must recycle the ids of finished
terminals/transfers. A bare `next++` emits `256` on the 256th hand-out and every `encode*Frame`
call throws from then on. Allocation walks forward from a caller-held cursor rather than always
returning the lowest free id, so a just-released id is the last one reused — a stale peer-side
subscription is not immediately re-pointed at a new transfer.

### `endpoint.ts`

Parses a daemon target string into an `EndpointDescriptor`:
- `host:port`, `host`, `tcp://…`, `ws://…`, `wss://…` → `kind: "direct"`
- `relay://relayHost/<relayId>` → `kind: "relay"`
- Default port: `6767` (`DEFAULT_DAEMON_PORT`)

### `provider-manifest.ts`

UI-only scaffolding types:
- `ProviderDefinition`, `ProviderMode`, `AgentCapabilityFlags` — includes `supportsExtensionUi?:
  boolean` (sprint-066): UI-presentation metadata only, like every other flag in this file (see its
  own header comment) — it does **not** gate whether the daemon forwards extension UI traffic (the
  Pi adapter and the mock provider both do so unconditionally); both `pi` and `mock`
  (`PI_CAPABILITIES`/`MOCK_CAPABILITIES`, `packages/server/AGENTS.md`) set it `true`
- `colorTierSchema` — `safe | moderate | dangerous | planning` (drives UI color)
- `providerIdSchema` — must match `/^[a-z][a-z0-9-]*$/`

---

## Invariants

- **Zero workspace imports.** `protocol` must compile and run without any other `@av-pi-studio/*`
  package. Check `package.json` — the only dependency is `zod`.
- **Append-only.** Never remove a field from a schema, never narrow a type, never change a
  discriminant value. All new fields must be optional with a default or `optional()`.
- **Cross-platform binary codecs.** Use `Uint8Array`, not `Buffer`. No Node-only APIs.
- **Schema passthrough.** Most schemas use `.passthrough()` so unknown future fields survive
  decode without errors on older clients.
- **`rpcName()` for new RPCs.** New handlers must use the dotted `domain.provider.operation.direction`
  convention. Legacy flat names are accepted via aliases but never generated.
- **Not every RPC has a schema here.** `list_agents_request`/`list_agents_response` is a real,
  actively-used daemon RPC (`agentId`/`status`/`title`/`cwd`/`labels`/`lastActivity`/`provider`/
  `model`) that has never been given a Zod schema — both server (`daemon/bootstrap.ts`,
  `dev-bootstrap.ts`) and client (`use-session-restore.ts`) handle it as an untyped
  `Record<string, unknown>` with a local TS interface cast. Don't assume every wire message is
  covered by this package; grep the actual handler registration before assuming a schema exists.

---

## How to add a new wire message type

1. Define the Zod schema + TypeScript type in `messages.ts` (or a new sub-file).
2. Add it to `sessionMessageSchema`'s discriminated union.
3. Export from `index.ts`.
4. Write a round-trip test in `messages.envelopes.test.ts` or a new `*.test.ts`.
5. Update `server`'s `HandlerRegistry` to register the handler.

---

## Testing

```bash
npx vitest run packages/protocol   # run only protocol tests
# or from root:
npm test
```

Tests are Vitest and live alongside source files as `*.test.ts`.
