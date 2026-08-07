# WebSocket Protocol — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [relay-e2ee.md](relay-e2ee.md), [auth-security.md](auth-security.md),
> [terminals.md](../features/terminals.md), [timeline-streaming.md](../features/timeline-streaming.md)

## Purpose

All clients (mobile, web, desktop, CLI) speak one WebSocket protocol to the daemon over a single
connection that mixes JSON text frames and a small binary framing for terminal/file streams. The
protocol is the compatibility contract between independently-versioned clients and daemons.

## Public Contract

### Connection & handshake
```
Client → Server (text JSON):  { type: "hello",
    clientId, clientType: "mobile" | "browser" | "cli" | "mcp",
    protocolVersion, appVersion?, capabilities?: { ... } }

Server → Client (text JSON):  { type: "status", payload: {
    status: "server_info", serverId, hostname?, version?, capabilities, features } }
```
There is no dedicated welcome message; the server emits the `status`/`server_info` message after
accepting the hello, then begins streaming. The server stores client capabilities from the hello
and rehydrates them on reconnect, so the wire boundary asks one question: `session.supports(...)`.

### Top-level envelopes
| Envelope `type` | Direction | Purpose |
|-----------------|-----------|---------|
| `hello` | C→S | Handshake |
| `ping` / `pong` | both | Liveness over the actual data path (not RFC6455 ping, not an RPC) |
| `session` | both | Wraps the rich union of session messages |

Liveness uses the JSON `ping`/`pong` envelope because browser/RN WebSocket APIs do not expose
protocol ping. RPC timeouts are operation failures and must **not** be treated as a dead socket.
`pong` carries `{ requestId, clientSentAt?, serverReceivedAt, serverSentAt }`.

### Session message families (non-exhaustive)
| Type(s) | Purpose |
|---------|---------|
| `create_agent_request` / response | Create an agent session |
| `agent_update` | Agent state changed (status, title, labels) |
| `agent_stream` | New timeline event from a running agent (may be delta-shaped) |
| `fetch_agent_timeline_request` / response | Authoritative paged timeline history |
| `agent_permission_request` / `agent_permission_resolved` | Tool-call permission flow |
| `agent_deleted`, `agent_archived`, `agent_status`, `agent_list` | Agent lifecycle |
| `workspace_update`, `script_status_update`, `workspace_setup_progress` | Workspace state |
| `checkout_*` and `checkout.github.*.request`/`.response` | Git operations (see git-checkout) |
| `file_watch_subscribe`/`unsubscribe`, `file_changed` | Live filesystem watches (see file-explorer-transfer) |
| Terminal `subscribe`/`input`/`capture`/`create`/`kill`/`rename` | Terminal control |

Correlated RPCs carry a `requestId` echoed in the response; failures emit `rpc_error` with the same
`requestId`.


### Push & subscription families (per-session live updates)

Some message types form **subscription families**: a client sends a `*_subscribe` request to start
receiving a stream of `*_update` or `*_changed` pushes from the daemon for a **specific key** (e.g.
a path, a git ref, a terminal id). These are **per-session only** — only the connection that
explicitly subscribed receives its updates; another client on a different connection to the same
daemon will not receive those pushes. Unsubscribing or dropping the connection releases the
subscription. Subscribing to the same key while already subscribed replaces the existing
subscription; no stacking.

#### `checkout_status_subscribe` / `checkout_status_update` (git status)
Subscribes to live updates of the git status projection for a specific `cwd` (workspace root).
Response confirms subscription or rejection. Daemon sends `checkout_status_update` pushes whenever
the status changes. Unsubscribe via `checkout_status_unsubscribe`. See [git-checkout.md](../features/git-checkout.md).

#### `file_watch_subscribe` / `file_watch_unsubscribe` / `file_changed` (filesystem changes)
Subscribes to filesystem changes at a **specific path** — either a file or a directory.

**Request:** `file_watch_subscribe`
- `path` (string): Absolute path or `~`-prefixed (e.g. `~/projects/myapp`). Server resolves `~`
  to the daemon user's home directory.
- **Response:** `{ ok: boolean, path, error?: "too_many_watches" }`
  - `ok: true` — subscription active; subsequent filesystem changes at this path will push
    `file_changed`.
  - `ok: false, error: "too_many_watches"` — connection hit the per-session cap of 128
    concurrently-watched paths. Unsubscribe from less-critical paths or reconnect.

**Unsubscribe:** `file_watch_unsubscribe`
- `path` (string): Same path format as subscribe; must match exactly.
- **Response:** `{ ok: true, path }`

**Push:** `file_changed`
- `{ type: "file_changed", path }` — the resolved path that changed. No file content or metadata.
- Delivered only to the connection that subscribed to this path.
- Coalesced server-side: multiple filesystem events for the same logical change (e.g. an editor's
  write-temp-then-rename pattern producing two raw OS events) collapse into a single `file_changed`
  push within ~150 ms per subscribed path.

**Semantics:**
- **Directory subscription:** Notifies on any child create, delete, or rename within that directory
  tree. Watchers are **not** recursive; only direct children trigger updates.
- **File subscription:** Notifies specifically for that file. The watch targets the file's parent
  directory and filters by the file's basename, so it survives the file being replaced via atomic
  rename (e.g. `ed temp; mv temp target` — a common save pattern) without losing the watcher.
- **Re-subscribe:** Subscribing again to an already-watched path replaces the subscription in place,
  does not stack, and does not count against the per-session cap.
- **Cleanup:** Unsubscribing explicitly releases the watch. If the connection closes (user
  disconnect, browser tab close, network drop) without explicit unsubscribe, the daemon's
  connection-close cleanup releases any watches that connection held. No permanent resource leak.

**Validation:** Like the `checkout_status_*` family, `file_watch_*` messages validate through the
lightweight passthrough fallback (`sessionMessageBaseSchema`) rather than a fully-typed schema
entry. This keeps the message discriminated union in `messages.ts` simpler while accommodating
future per-path optional fields.

### RPC naming convention
- New RPCs use **dotted namespaces with a direction suffix**:
  `domain.provider.operation.request` paired with `...response` (e.g.
  `checkout.github.set_auto_merge.request`/`.response`).
- Segments read left→right: domain → provider/subsystem → operation (a verb) → direction.
- Requests keep parameters at the top level; responses put result data under `payload`. Both carry
  `requestId`.
- Legacy flat names (e.g. `checkout_pr_merge_request`) remain accepted; do not add new flat names.

### Binary frames — terminal stream
Decoded/encoded by the terminal stream codec. Layout:
- 1 byte **opcode**: `Output = 0x01`, `Input = 0x02`, `Resize = 0x03`, `Snapshot = 0x04`
  (plus a `Restore` opcode).
- 1 byte **slot**: terminal slot id.
- variable **payload**: raw bytes for output/input; JSON `{ rows, cols }` for resize; terminal
  snapshot bytes for snapshot.

A separate **file-transfer** binary frame format lives in the same module for download/upload
streams.

## Behavior & Algorithms

```
on connection:
    validate Host header against allowlist        # see auth-security.md
    validate auth (password) if configured         # bearer subprotocol for WS
    if relay connection: complete e2ee handshake before any app message
    expect first frame = hello
    register session; persist client capabilities
    emit status/server_info
    route subsequent frames:
        text → parse session union → dispatch to handler → correlated response/broadcast
        binary → decode frame → terminal/file-transfer router

on reconnect:
    rehydrate stored capabilities for clientId
```

### Compatibility rules (the protocol contract)
- Schemas are **append-only**. Add optional fields with defaults/transforms. Never remove fields,
  flip optional→required, or narrow types (`string`→enum, nullable→non-null).
- New wire **enum values** are gated at serialization via `session.supports(CLIENT_CAPS.x)` so old
  clients receive the old value.
- Removed fields stay *accepted* (stop sending, keep reading).
- New *features* (not fields) advertise a flag in `server_info.features.*`; clients run the feature
  or show "update the host." No degraded fallback path.

### Capability flags
- `server_info.features.*` (daemon→client): e.g. `providersSnapshot`, `checkoutGithubSetAutoMerge`,
  `daemonStatusRpc`, `terminal-restore-modes`, `rewind`, `checkoutRefresh`. Each is tagged with a
  `COMPAT(name)` comment carrying the version added and removal date.
- `CLIENT_CAPS.*` (client→daemon, in hello): e.g. `custom_mode_icons`, `reasoning_merge_enum`,
  `terminal_reflowable_snapshot`.

## Error Handling & Edge Cases
| Condition | Expected behavior | Surface |
|-----------|-------------------|---------|
| First frame not `hello` | Reject / close | connection error |
| Unknown session message type | Ignore or `rpc_error` per handler | `rpc_error` |
| RPC handler throws | Emit `rpc_error` with `requestId` | session message |
| Large timeline response exceeds relay frame size | Use bounded paging (see timeline-streaming) | paged responses |
| Old client receives new enum value | Prevented by capability gating | — |

## Dependencies
- Internal: session, agent manager, all feature handlers, terminal/file routers.
- External: `ws`, browser/RN WebSocket on the client side.

## Acceptance Criteria
- [ ] A client that sends `hello` receives a `status`/`server_info` with `serverId` and `features`.
- [ ] `ping` yields a `pong` with the same `requestId`; an RPC timeout does not close the socket.
- [ ] An old client never receives a wire enum value it didn't advertise support for.
- [ ] Terminal output arrives as binary frames with opcode `0x01` and a slot byte.
- [ ] A failed RPC returns `rpc_error` correlated by `requestId`.

## TODO(verify)
- [ ] Full enumeration of session message types and their payload shapes.
- [ ] Exact `clientType` value for desktop (uses `browser`).
- [ ] Current `CLIENT_CAPS` and `features.*` lists and their floor versions.
