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
    index.ts                              Re-exports both binary codecs.
    terminal-stream-protocol.ts           Terminal binary frame codec (opcode+slot framing).
    terminal-stream-protocol.test.ts
    file-transfer-protocol.ts             File download/upload binary frame codec.
    file-transfer-protocol.test.ts
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
| `agentStreamEventSchema` / `AgentStreamEvent` | discriminated union | Turn events: user_message (optional `images`), assistant_message, reasoning, tool_call, turn_started/completed/failed/canceled, error, `queue_update` (`steering[]`/`followUp[]` — pending steering/follow-up queue changed) |
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
| `rpcErrorSchema` / `RpcError` | schema + type | Correlated RPC error response |
| `sessionMessageSchema` / `SessionMessage` | discriminated union | All currently-defined session message types |
| `sessionMessageBaseSchema` / `SessionMessageBase` | schema + type | Structural fallback (`{ type: string }.passthrough()`) for any session message not yet in the union |
| `sessionEnvelopeSchema` / `SessionEnvelope` | schema + type | `{ type: "session", message }` top-level envelope |
| `topLevelEnvelopeSchema` / `TopLevelEnvelope` | discriminated union | hello \| status \| ping \| pong \| session |
| `rpcName(domain, sub, op, dir)` | function | Build a canonical dotted RPC name |
| `agentStatusEnum` / `AgentStatus` | enum | `initializing \| idle \| running \| error \| closed` |
| `wireTimestampSchema` / `WireTimestamp` | schema | `number \| ISO-8601 string` (never narrowed) |

### `client-capabilities.ts`

| Export | Description |
|--------|-------------|
| `CLIENT_CAPS` | `custom_mode_icons`, `reasoning_merge_enum`, `terminal_reflowable_snapshot` — flags the client advertises in `hello.capabilities` |
| `SERVER_FEATURES` | `providersSnapshot`, `checkoutGithubSetAutoMerge`, `daemonStatusRpc`, `terminal-restore-modes`, `rewind`, `checkoutRefresh` — features the daemon advertises in `server_info.features` |
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
- All other payloads are raw bytes (pass-through).
- Uses `Uint8Array` (not `Buffer`) — runs in browser/RN.

### `binary-frames/file-transfer-protocol.ts`

Binary framing for file download/upload operations.

### `endpoint.ts`

Parses a daemon target string into an `EndpointDescriptor`:
- `host:port`, `host`, `tcp://…`, `ws://…`, `wss://…` → `kind: "direct"`
- `relay://relayHost/<relayId>` → `kind: "relay"`
- Default port: `6767` (`DEFAULT_DAEMON_PORT`)

### `provider-manifest.ts`

UI-only scaffolding types:
- `ProviderDefinition`, `ProviderMode`, `AgentCapabilityFlags`
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
