# Feature — Desktop-Client Protocol Follow-ups II

> **Status: shipped on `feat/desktop-protocol-followups-2` (2026-11-15): sprint 097 (download) and
> sprint 098 (agent stream mode, CLI JSON), both built and live-checked.** See `swe/sprints/PLAN.md`.
> Follows [desktop-client-protocol-followups.md](desktop-client-protocol-followups.md) (sprint 096,
> shipped in 0.0.118); the code is first carried by 0.0.119.

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md)
> (handshake, append-only rule), [file-explorer-transfer.md](file-explorer-transfer.md) (transfer
> frames and RPCs), [timeline-streaming.md](timeline-streaming.md) (`agent_stream`),
> [cli.md](cli.md) (`daemon` command group),
> [../architecture/external-client-fixtures.md](../architecture/external-client-fixtures.md)
> (fixture format, breaking-change rule),
> [../architecture/workbench-host-adapter.md](../architecture/workbench-host-adapter.md) (browser
> host `files`)
> Consumer brief: [../../docs/desktop-client-handoff.md](../../docs/desktop-client-handoff.md)

## Purpose

Pi Studio Desktop moves file transfer into a Rust engine on its own daemon connection, serves
viewers from local URLs with range requests, raises notifications while its window is closed, and
starts or finds a local daemon. Four things in this repository stand in the way:

1. A download always starts at byte 0, never says how large the file is, cannot be cancelled, and
   answers its request only after the whole file has been sent.
2. Every download needs a token round trip that authorises nothing.
3. Every session receives every agent's stream events; a connection that only moves files cannot
   opt out.
4. `pi-studio daemon start` and `daemon pair` print text and a QR code; a supervising program
   cannot read their result.

This scope closes those four. Two of the changes remove something from the wire (§ Decisions D1,
D4); the rest are additive.

## Decisions

Taken with the project owner on 2026-11-15. They are requirements here, not open choices.

| # | Decision |
|---|---|
| D1 | **The download token is removed.** `file_download_request` takes a `path`. `file_download_token_request`/`_response` are deleted outright, with no compatibility release |
| D2 | A later range of the same file is protected by a stateless validator (`ifUnchanged`), not by a server-side handle |
| D3 | **Quiet sessions use a mode, not a boolean:** `hello.agentStreams` is `"all"` or `"none"`. Per-agent stream subscriptions are **parked**; they would add a third value later |
| D4 | **Breaking wire changes are accepted in this scope** (the user base is small). This overrides the append-only rule for the messages named in § Removed |
| D5 | Upload resume is out of scope |
| D6 | `pi-studio-dashboard` is not a compatibility constraint |
| D7 | **`file_download_response` is sent before the stream** (§ 1.2). The after-the-stream reply fails any transfer that outlasts the client's RPC timeout |
| D8 | **Downloads can be cancelled** with `file_download_cancel_request` (§ 1.4). Without it the only way to stop one is to close the connection, which ends every other transfer on it |
| D9 | The daemon tracks active downloads per session and rejects a second one on the same stream id with `stream_in_use` (§ 1.1). Follows from D8 |

D7–D9 were added while scoping and confirmed by the owner on 2026-11-15.

## Current state (verified in code, pi-studio 0.0.118)

**Download.** Two requests: `file_download_token_request { path }` returns a random single-use
token (10-minute TTL, 10 000-entry LRU, `packages/server/src/files/download-token-store.ts`);
`file_download_request { token, stream? }` consumes it and streams `Begin`, `Chunk`…, `End`
(`packages/server/src/files/file-transfer.ts`). The store's own comment says the TTL "is a cleanup
device, not an authorization control". The file is read with no start or end position. `Begin`
carries `transferId`, `fileName`, `mimeType`; the schema allows `totalBytes` but the daemon never
sets it. **`file_download_response` is sent after the last frame**, so the request stays pending for
the whole transfer: `DaemonClient`'s default RPC timeout is 30 s (`packages/client/src/daemon-client.ts`;
the workbench raises it to 30 minutes), and a transfer that outlasts it is reported as failed. The
daemon does not track downloads: the stream id is whatever the client sent, and nothing can stop a
download except closing the socket.

**Tokens elsewhere.** The file explorer's binary preview result also carries a `transferToken`
(`packages/server/src/files/file-explorer.ts`). No client in this repository reads it. The SDK's
`FileTransferClient.download` is the only code that redeems a token, and it retries once on
`invalid_or_expired_token`.

**SDK download.** `download(path)` keeps every chunk in an array, concatenates them and returns
one `Uint8Array` (`packages/client/src/file-transfer-client.ts`). The browser host copies that into
a `Blob` (`packages/workbench/src/host/browser-files.ts`). There is no range, progress or abort.

**Agent streams.** Each `agent_stream` frame goes to every active session, direct and relay
(`appendStreamEvent` and three `user_message` sites in `packages/server/src/agent/agent-service.ts`
and `session-operations.ts`, through `getActiveSessions()` in `daemon/bootstrap.ts`). Filtering is
client-side: the SDK's `timeline.subscribe` and the CLI's follow command compare `agentId` locally.
Turn status does **not** depend on the stream: `agent_update { status }` (`running`, `idle`,
`error`) and `agent_ui_request`/`agent_ui_resolved` are separate broadcasts.

**CLI.** `--json` is a global flag. Among the `daemon` commands only `status` honours it
(`{ up, host, port }`). `start`, `restart` and `pair` print prose, a terminal QR code and
`Pairing link: <url>`; `stop` prints one line (`packages/cli/src/daemon-commands.ts`).

## Public contract

### 1. Download by path, ranged, sized, cancellable

Advertised as `server_info.features.fileDownloadRanges`.

#### 1.1 `file_download_request`

| Field | Type | Detail |
|---|---|---|
| `path` | string, required | `~` is expanded by the daemon; the path is then resolved through symlinks |
| `stream` | integer 0–255, optional | Chosen by the client. Omitted: the daemon picks one that is free on this session |
| `offset` | integer ≥ 0, optional | First byte to send. Default 0 |
| `length` | integer ≥ 1, optional | Most bytes to send. Default and upper bound: to the end of the file |
| `ifUnchanged` | `{ size, mtimeMs }`, optional | Reject unless the file still has this size and modification time |

Download stream ids are scoped to the session: two sessions may use the same id at once. Upload
stream ids stay daemon-wide and daemon-allocated, as today.

#### 1.2 `file_download_response`

Sent **before** any binary frame, as soon as the daemon has accepted or rejected the request.

| Outcome | Shape |
|---|---|
| Accepted | `{ ok: true, stream, transferId, totalBytes, mtimeMs, offset, length }` |
| Rejected | `{ ok: false, error, stream? }`; no binary frame follows. `changed` also carries the current `totalBytes` and `mtimeMs` |

`totalBytes` is the whole file's size. `length` is the number of bytes that will follow (the
request's `length` clamped to the end of the file; 0 when `offset` equals `totalBytes`). `mtimeMs`
is an **integer**: the modification time truncated to whole milliseconds, so every client can echo
it back exactly.

| `error` | When |
|---|---|
| `missing_path` | `path` absent or empty |
| `not_found` | The path does not resolve |
| `not_a_file` | It resolves to a directory or another non-regular file |
| `unreadable` | It cannot be opened for reading |
| `invalid_stream` | `stream` is not an integer in 0–255 |
| `stream_in_use` | This session already has a download on `stream` |
| `invalid_range` | `offset` or `length` is not an integer in its allowed range |
| `range_not_satisfiable` | `offset` is greater than the file's size |
| `changed` | `ifUnchanged` does not match the file (a value that is not `{ size, mtimeMs }` never matches) |
| `no_free_stream` | `stream` was omitted and this session has all 256 ids in use (same code as uploads) |

#### 1.3 Binary frames

After an accepted response: `Begin`, zero or more `Chunk`, then exactly one of `End` or `Error`.
Opcodes, the two-byte header and the 32 KiB chunk size are unchanged.

**One exception: an early cancel.** A download cancelled before its stream has started sends
`Error` `cancelled` alone, with **no `Begin`**. This happens when the cancel request reaches the
daemon while it is still opening the file (§ 1.4). A client must accept `Error` as the first and
only frame of a stream.

| Frame | Change |
|---|---|
| `Begin` metadata | Gains `mtimeMs`, `offset`, `length`; `totalBytes` is now always set on a download. Same values as the response |
| `End` | Unchanged. Sent only when exactly `length` bytes were sent |
| `Error` message | `read_failed`, `changed` (the file ended before `length` bytes were read) or `cancelled`. Final: no `End` follows |

No message follows `End` or `Error`.

#### 1.4 `file_download_cancel_request`

| Message | Shape |
|---|---|
| Request | `{ stream }` |
| Response | `{ ok: true }`, or `{ ok: false, error: "not_found" }` when this session has no download on `stream` |

On `ok: true` the daemon stops reading and sends `Error` with `cancelled` on the stream.

The stream id is reserved as soon as the download request arrives, before the file is opened, so a
cancel sent right after the request finds it and answers `ok: true` **before** the download request
itself has been answered. What follows then is exactly one of:

| The open… | The client receives |
|---|---|
| succeeds | `file_download_response { ok: true, … }`, then `Error` `cancelled` with no `Begin` |
| fails | `file_download_response { ok: false, error }` and no frame |

So after a cancel answered `ok: true`, a stream ends with an `Error` frame or with the refusal of
its request, never with silence.

#### 1.5 Removed

| Removed | Replacement |
|---|---|
| `file_download_token_request`, `file_download_token_response` | None: request by `path` |
| `file_download_request.token` | `path` |
| Error `invalid_or_expired_token` | None |
| `transferToken` in the file explorer's binary preview result | None; `metadata` (`size`, `mtimeMs`, `mimeHint`) stays |
| `DownloadTokenStore` and its dependency in `FileTransferService` and `FileExplorerService` | None |

#### 1.6 SDK (`@av-pi-studio/client`)

| API | Contract |
|---|---|
| `FileTransferClient.download(path, options?)` | Unchanged result plus `totalBytes`, `mtimeMs`, `offset`. Buffers the requested range in memory |
| `FileTransferClient.downloadTo(path, sink, options?)` | Calls `sink(chunk)` once per `Chunk`, in wire order, and keeps no reference to it. Resolves with `{ fileName?, mimeType?, totalBytes, mtimeMs, offset, length }` after `End` |
| `options` (both) | `offset?`, `length?`, `ifUnchanged?`, `signal?`, `onProgress?(received, length)` |
| Abort | Sends `file_download_cancel_request` and rejects with an `AbortError` |
| Rejections | An `Error` whose message is the daemon's `error` code or `Error`-frame message |
| Daemon without `fileDownloadRanges` | Rejects before sending anything, with a message that names the feature and says the daemon must be updated |

The token request, the token types and the retry-on-expired path are deleted from the SDK.

#### 1.7 Browser host (`@av-pi-studio/workbench`)

`files.saveToDisk` and `files.openForView` build their `Blob` directly from the chunks delivered by
`downloadTo`, instead of from one concatenated array. The `WorkbenchHost` contract does not change.

#### 1.8 Compatibility

| Client | Daemon | Behaviour |
|---|---|---|
| New | New | As specified |
| New | Old (no `fileDownloadRanges`) | Downloads fail in the SDK with the "update the daemon" error. Everything else works |
| Old | New | The token request gets `rpc_error` `unknown_message_type`; downloads fail. Uploads and everything else work |

### 2. Agent stream mode

Advertised as `server_info.features.agentStreamsMode`.

| Change | Detail |
|---|---|
| `hello.agentStreams` | New optional string: `"all"` (default) or `"none"`. Any other value is treated as `"all"`; the handshake still succeeds |
| Session | Stores the mode for the life of the connection. It cannot be changed without reconnecting |
| `"none"` | The session receives **no** `agent_stream` frame, for any agent, whoever started the turn. Direct and relay sessions alike |
| Everything else | Unchanged for a `"none"` session: RPC replies, `agent_update`, `agent_ui_*`, `agent_timeline_reset`, `agent_todos_update`, `terminals_update`, workspace and skills pushes, per-session subscriptions, `fetch_agent_timeline_request` |
| `daemon_status` session entries | Gain `agentStreams`, present only when the mode is not `"all"` |
| SDK | `DaemonClientOptions.agentStreams?: "all" \| "none"`, sent when set. With `"none"`, `timeline.subscribe` listeners never fire |

A client that needs "the turn ended" or "the agent is waiting for the user" without the stream reads
`agent_update.status` (`running` → `idle` or `error`) and `agent_ui_request`/`agent_ui_resolved`.
The detailed outcome (`turn_completed`, `turn_failed`, `turn_canceled`) exists only in the stream and
in fetched history.

An unknown value falls back to `"all"` so that a client built for a later mode never receives
*less* than it asked for from a daemon that predates that mode.

### 3. Machine-readable daemon commands

With the global `--json` flag each command below writes **exactly one line of JSON** to standard
output and nothing else: no QR code, no prose. Without the flag, output is unchanged.

| Command | Success | Failure (non-zero exit) |
|---|---|---|
| `daemon start`, `daemon restart` | `{ "up": true, "started": <bool>, "host", "port", "pairingUrl", "relay" }` | `{ "up": false, "host", "port", "error": "not_healthy" }`; or, daemon healthy but no key file, `{ "up": true, "started": <bool>, "host", "port", "error": "no_keypair" }` |
| `daemon pair` | `{ "pairingUrl", "relay" }` | `{ "error": "no_keypair" }` |
| `daemon stop` | `{ "stopped": true }` | `{ "stopped": false }` |

`started` is `false` when a daemon was already running at that address. `relay` is the relay
endpoint string the pairing link routes through, or `null`. `error` is `not_healthy` (`up: false`:
the daemon did not answer its health check in time) or `no_keypair` (no daemon keypair exists in the
CLI's home; for `start`/`restart` it is reported with `up: true`, because the daemon is healthy).
`daemon status --json` is unchanged; `rotate-key`, `onboard` and the bare `pi-studio` command ignore
`--json`. The flag is global, so it precedes the subcommand: `pi-studio --json daemon start`.

`pairingUrl` is a credential on a relay-routed link, exactly as the printed link is today; `--json`
does not widen who can read it.

### 4. Fixtures

| Change | Files |
|---|---|
| Removed | `file_download_token_request.json`, `file_download_token_response.json` |
| Changed shape | `file_download_request.json` (`token` → `path`), `file_download_response.json` (now the acceptance reply) |
| New | `file_download_request.range.json`, `file_download_response.rejected.json`, `file_download_cancel_request.json`, `file_download_cancel_response.json`, `hello.agentStreams.json` |
| New binary | A download `Begin` carrying `totalBytes`, `mtimeMs`, `offset`, `length`. The existing `Begin` fixture is not edited |

Removing files and changing a request's fields is a breaking change under the fixtures'
"bump + note" rule: `manifest.json`'s `formatVersion` goes from 1 to 2, with a dated
`CHANGELOG.md` entry naming the files and the migration (request by `path`; read the response before
the frames). The download fixtures carry `requiresFeature: "fileDownloadRanges"`. The binary
manifest's `formatVersion` stays 1: its change is one added file.

The live fixture scenario (`packages/server/src/test-support/external-fixtures-scenario.ts`) and the
dev daemon's wiring drop the token step.

## Behavior & algorithms

### Download (daemon)

```
on file_download_request { path, stream?, offset = 0, length?, ifUnchanged? }:
    validate stream            -> invalid_stream
    if this session has a download on stream -> stream_in_use
    resolved = resolve(expandHome(path))      -> missing_path | not_found
    info = stat(resolved)                     -> not_a_file | unreadable
    size = info.size; mtimeMs = trunc(info.mtimeMs)
    validate offset, length    -> invalid_range
    if offset > size           -> range_not_satisfiable
    if ifUnchanged given and (ifUnchanged.size, ifUnchanged.mtimeMs) != (size, mtimeMs)
                               -> changed { totalBytes: size, mtimeMs }
    effective = min(length ?? infinity, size - offset)

    register (session, stream) as an active download      # done first, before the file is opened
    reply { ok, stream, transferId, totalBytes: size, mtimeMs, offset, length: effective }
    if cancelled already:  send Error "cancelled"; release; stop      # no Begin (§ 1.3)
    send Begin { transferId, fileName, mimeType, totalBytes: size, mtimeMs, offset, length: effective }

    sent = 0
    for each chunk read from [offset, offset + effective), at most 32 KiB:
        if cancelled:       send Error "cancelled";  release; stop
        if socket closed:   release; stop            # nothing is sent
        send Chunk; sent += chunk size
        pace on the socket's buffered amount         # unchanged, sprint 096
    on read error:          send Error "read_failed"; release; stop
    if sent < effective:    send Error "changed";     release; stop
    send End ok; release

on file_download_cancel_request { stream }:
    if no active download for (session, stream) -> not_found
    mark it cancelled; reply ok

on session closed:
    release every download of that session
```

The reply is written to the socket before `Begin`, so a client always sees them in that order.

### Resuming and seeking (any client)

```
first request:   { path }                     -> remember (totalBytes, mtimeMs), count bytes received
after a drop:    { path, offset: received, ifUnchanged: { size: totalBytes, mtimeMs } }
    ok           -> append
    changed      -> discard what was received; start again from 0
viewer seek:     { path, offset, length, ifUnchanged }   # one request per range
    superseded by a newer seek -> file_download_cancel_request { stream }
```

A client can bound its own memory on a connection the daemon cannot pace (the relay) by asking for
ranges of a fixed size, one after the other.

### `downloadTo` (SDK)

```
downloadTo(path, sink, { offset, length, ifUnchanged, signal, onProgress }):
    if server lacks fileDownloadRanges: reject "daemon too old"
    stream = next free id; register it BEFORE sending the request
    response = request file_download_request { path, stream, offset, length, ifUnchanged }
    if not response.ok: release stream; reject response.error
    if the request times out: reject with the timeout; cancel and keep the id as for an abort;
                     a late refusal of the request (no frame follows one) releases the id
    on Chunk: sink(chunk); received += size; onProgress(received, response.length)
    on End:   release; resolve { ...Begin metadata }
    on Error: release; reject message              # also when no Begin came first (early cancel)
    on signal abort: reject AbortError at once; request file_download_cancel_request { stream };
                     keep the id registered until a terminal frame arrives, the request is refused,
                     or the cancel answers not_found (a late `Error cancelled` must not reach a
                     download that reused the id)
    on connection closed: release; reject
    result metadata comes from Begin; an End short of the announced length rejects;
    a sink or onProgress that throws aborts the download the same way

download(path, options) = downloadTo collecting chunks, then one buffer
```

### Agent stream mode (daemon)

```
on hello: session.agentStreams = hello.agentStreams if it is "all" or "none", else "all"
on every agent_stream frame, at every site that sends one:
    recipients = active sessions where session.agentStreams == "all"
```

The event is appended to the timeline regardless of who is listening.

## Data & persistence touchpoints

None. The token store was in memory only. `agentStreams` is a connection fact like `platform`; it
is not written to the capability store.

## Error handling & edge cases

| Condition | Expected behavior |
|---|---|
| Zero-byte file | Accepted with `totalBytes: 0`, `length: 0`; `Begin`, `End` |
| `offset` equals the file size | Accepted with `length: 0`; `Begin`, `End`. This is what a completed resume looks like |
| `length` larger than what remains | Clamped; the response and `Begin` report the real count |
| File truncated while it is being sent | `Error` `changed` after the bytes that could be read |
| File grows while it is being sent | Only the announced `length` bytes are sent; the next request's `totalBytes` shows the growth |
| File replaced with one of the same size inside the file system's timestamp granularity | `ifUnchanged` does not detect it. Accepted limitation |
| Cancel arrives after `End` was sent | `not_found`; the client ignores it |
| Two downloads on one session with the same `stream` | The second is rejected with `stream_in_use`; the first is unaffected |
| Session closes mid-download | The read stops, the stream id is released, nothing is sent |
| RPC timeout on the client | Applies only to the acceptance reply, not to the transfer |
| `hello.agentStreams` is a number, an object or an unknown string | Treated as `"all"` |
| A `"none"` session starts a turn itself | It still receives no `agent_stream`; the request's own reply is unaffected |
| `"none"` sent to a daemon without `agentStreamsMode` | The field is ignored and streams arrive; the client must tolerate them |
| `daemon start --json` when the daemon is already up | `started: false`, exit 0 |
| `daemon pair --json` before any daemon has run | `{ "error": "no_keypair" }`, non-zero exit |
| `daemon start --json` when the daemon is healthy but the CLI's home has no key file | `{ "up": true, "started": <bool>, "host", "port", "error": "no_keypair" }`, non-zero exit |

## Dependencies on other specs

- [file-explorer-transfer.md](file-explorer-transfer.md): its download section (token request,
  token semantics, "binary preview returns a transfer token") is replaced by § 1 here.
- [desktop-client-protocol-followups.md](desktop-client-protocol-followups.md): pacing, the
  `Error`-without-`End` rule, upload acknowledgement and session-owned upload streams are kept
  as built. Its statement "the token flow does not change" is superseded.
- [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md): the append-only
  rule gets one recorded exception (D4).
- [../architecture/external-client-fixtures.md](../architecture/external-client-fixtures.md): first
  use of the breaking-change procedure (`formatVersion` 2).
- [timeline-streaming.md](timeline-streaming.md): "broadcast to subscribed clients" becomes
  "broadcast to sessions whose mode is `all`".
- [cli.md](cli.md): the `daemon` group gains JSON output.

## Non-goals

- Upload resume, and any change to the upload flow.
- Per-agent stream subscriptions (parked, D3).
- A different chunk size, or transfer over HTTP or a dedicated socket type.
- More than one client per daemon on the relay: a separate scope.
- Changes to the `WorkbenchHost` contract (download progress in the explorer, range-aware viewers,
  native file drops): a separate scope, after the desktop shell runs on all three platforms.
- A new `clientType` value.
- `pid` or version in `daemon status --json`.

## Acceptance criteria

Download:

- [x] A request with `path` and no range sends the whole file; the response and `Begin` carry the
      file's size as `totalBytes` and `length`, and its modification time as an integer `mtimeMs`.
- [x] A request with `offset` and `length` sends exactly those bytes; concatenating consecutive
      ranges of a file reproduces it byte for byte.
- [x] `file_download_response` reaches the client before `Begin`, and no message follows `End`.
- [x] A download that runs longer than the client's RPC timeout completes (proved by a router test in
      which the response is on the wire while a stalled client still has most of the file to receive,
      and live: first `Chunk` 2 ms after the request, a 6 s client pause completes).
- [x] Each rejection in § 1.2 is returned for its condition, with no binary frame.
- [x] `ifUnchanged` with stale values is rejected with `changed` and the current values; with
      current values the range is served.
- [x] Interrupting a download and resuming it with `offset` and `ifUnchanged` yields a file with a
      matching SHA-256; resuming after the file was modified yields `changed`.
- [x] `file_download_cancel_request` stops the transfer: the client sees `Error` `cancelled`, and
      the daemon reads no further from the file.
- [x] A second download on a stream id in use is rejected with `stream_in_use`; after `End` the id
      can be reused.
- [x] A closed session leaves no active download and no open file handle.
- [x] `file_download_token_request` gets `rpc_error` `unknown_message_type`; no token store, token
      type or `transferToken` field remains in the repository.
- [x] SDK: `downloadTo` delivers chunks in order and retains none (a test downloads more than the
      high-water mark with a sink that discards, and the client's held bytes stay bounded);
      `onProgress` is monotonic and ends at `length`; aborting rejects with `AbortError` and releases
      the stream id once the daemon's final frame has arrived (the SDK holds it until then, so a late
      `Error` cannot reach a reused id).
- [x] SDK against a daemon without `fileDownloadRanges`: `download` rejects with the
      update-the-daemon message and sends nothing.
- [x] Browser host: saving and viewing a file work as before in a live browser check; the code no
      longer concatenates the file into one array before making the `Blob`.
- [x] Pacing still bounds the daemon's socket buffer during a ranged download (the sprint 096 test
      still passes).

Agent stream mode:

- [x] A session that sent `agentStreams: "none"` receives no `agent_stream` frame during a turn on
      a mock agent, including a turn it started itself, and does receive the `agent_update`
      `running` and `idle` broadcasts for that turn (unit: `agent-stream-mode.test.ts`; live: a
      quiet connection that started a `#tool shell` turn saw 0 stream frames and both statuses).
- [x] A second session with no `agentStreams` field receives the full stream during the same turn
      (live: 9 frames against 0).
- [x] The same holds for a relay session (unit level): the relay `hello` path carries the mode
      (`bootstrap.test.ts`, real E2EE handshake), and the recipient filter is per `Session`,
      independent of transport.
- [x] An invalid `agentStreams` value yields a successful handshake and mode `all` (schema, direct
      WebSocket and live checks).
- [x] `daemon_status` lists `agentStreams: "none"` for the quiet session and omits the field for
      the other (unit and live).
- [x] `server_info.features` contains `fileDownloadRanges` and `agentStreamsMode` (live, production
      daemon; the dev daemon advertises every `SERVER_FEATURES` key).

CLI:

- [x] `daemon start --json` prints one parseable line with the fields in § 3 both when it starts a
      daemon and when one is already running, and prints no QR code (live and unit).
- [x] `daemon pair --json`, `daemon stop --json` and `daemon restart --json` print one parseable
      line each, with the documented failure shapes and exit codes (live: `pair` before any daemon
      `{"error":"no_keypair"}` exit 1; `stop` with nothing running `{"stopped":false}` exit 1).
- [x] Without `--json` the output of all four commands is unchanged (byte-for-byte unit tests for
      `start`, `pair` and `stop`; `restart` shares `start`'s path).

Fixtures and documents:

- [x] The fixture set matches § 4; `manifest.json` has `formatVersion` 2; `CHANGELOG.md` has the
      dated breaking entry; signatures are regenerated; both fixture test layers pass, including the
      live dev-daemon layer for the new download shapes.
- [x] `docs/desktop-client-handoff.md`, the root `AGENTS.md` protocol section,
      `packages/{protocol,client,server,workbench,cli}/AGENTS.md`, the fixtures `README.md`,
      `file-explorer-transfer.md`, `cli.md`, `timeline-streaming.md` and `websocket-protocol.md` are
      updated in the same change.

## TODO(verify)

- **Two fixtures for one binary opcode.** Resolved: the binary round-trip test now expects ten
  fixtures, two of them for `Begin`; the existing `Begin` fixture is unedited.
- **Other readers of `transferToken`.** None in this repository (`packages/client`,
  `packages/workbench`, `packages/cli` were searched). An out-of-tree client was not checked.
- **`HtmlViewer` asset downloads.** `packages/workbench/src/features/files/HtmlViewer.tsx` calls the
  SDK's `download` directly instead of going through `host.files`. It keeps working here; whether it
  should move behind the host belongs to the workbench seams scope.
- **Water marks.** Still the chosen 1 MiB and 256 KiB; no LAN or relay measurement exists.
- **Real Pi turn and relay, live.** The agent-stream mode was live-checked with the mock provider
  over a direct connection; a turn on a real Pi agent and a live relay session were not run.
- **`daemon start --json` with a healthy daemon and no key file.** Decided with the engineer:
  `{ "up": true, "started", "host", "port", "error": "no_keypair" }`, non-zero exit (§ 3).
