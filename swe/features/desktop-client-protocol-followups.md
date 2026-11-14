# Feature — Desktop-Client Protocol Follow-ups

> **Status: shipped (2026-11-14), sprint 096** on `feat/desktop-protocol-followups`, stacked on
> `feat/workbench`; the next release (0.0.118) is the first to carry it. Everything in § 1–§ 3 is built:
> `hello.platform`, the daemon's paced download / `Error` without `End` / session-owned upload streams,
> `fileTransferAck` + `file_upload_complete`, the SDK's paced `upload` with progress and abort, the
> browser host's streaming upload, and JSON + binary fixtures. Runs after
> [../architecture/workbench-package.md](../architecture/workbench-package.md).

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md)
> (append-only rules, handshake), [file-explorer-transfer.md](file-explorer-transfer.md) (transfer
> frames), [terminals.md](terminals.md) (terminal frames),
> [../architecture/external-client-fixtures.md](../architecture/external-client-fixtures.md)
> (fixture format and tests), [../architecture/workbench-host-adapter.md](../architecture/workbench-host-adapter.md)
> (`files.upload`)
> Consumer brief: [../../docs/desktop-client-handoff.md](../../docs/desktop-client-handoff.md)

## Purpose

Pi Studio Desktop will speak the daemon protocol from Rust: a transport bridge for the interactive
connection and its own connection for file transfer. Three gaps in this repository would make that
client build on behaviour nobody has pinned down:

1. The handshake cannot say "this is the desktop app".
2. File transfer has no flow control and no completion signal, on either side.
3. The external-client fixtures do not cover file transfer or terminals.

This scope closes those three. Every change is additive on the wire.

## Current state (verified in code, pi-studio 0.0.117)

**Handshake.** `hello.clientType` is `z.enum(["mobile", "browser", "cli", "mcp"])`
(`packages/protocol/src/messages.ts`). A comment there says the desktop app connects as `browser`.
`helloSchema` is a plain object schema, so unknown keys are dropped, not rejected. On a relay
connection a `hello` that fails validation is ignored silently (`daemon/bootstrap.ts`): the client
sees no answer. The daemon keeps `clientType` as a plain string on the session and reports it in
`daemon_status`.

**Upload.** `FileTransferClient.upload(path, bytes)` takes the whole file as one `Uint8Array` and
calls `sendBinary` for every 32 KiB chunk in one synchronous loop
(`packages/client/src/file-transfer-client.ts`). `Transport` exposes no buffered-amount signal. The
promise resolves when the frames are queued, not when the daemon has written them. On the daemon
(`packages/server/src/files/file-transfer.ts`) frames are written through a per-stream promise
chain; a write error is not reported to the client, and `End` produces no reply. `web-client`
reads the file with `File.arrayBuffer()` first (`hooks/use-file-transfer.ts`).

**Download.** The daemon reads the file with a 32 KiB stream and calls `session.sendBinary` for
every chunk without waiting for the socket to drain. On a read error it sends `Error` and then
still sends `End` with `ok: true`.

**Upload streams.** Pending uploads are keyed by stream id in one map for the whole daemon. The
binary frame handler does not check which session a frame came from.

**Fixtures.** `packages/protocol/fixtures/external-clients/` has 60 entries, `formatVersion` 1,
JSON frames only. None covers a `file_*` or terminal message. The original fixture scope lists
terminals as out of scope for the dashboard.

## Public contract

### 1. Client platform in the handshake

| Change | Detail |
|---|---|
| `hello.platform` | New optional string. Free-form, lowercase; the desktop app sends `"desktop"` |
| `hello.clientType` | **Unchanged.** The desktop app keeps sending `"browser"` |
| Session | Stores `platform` when present |
| `daemon_status` session entries | Gain optional `platform` |
| SDK | `DaemonClientOptions.platform?: string`, sent when set |

Widening the `clientType` enum is rejected: a daemon up to 0.0.117 fails validation on an unknown
value, and on a relay connection that failure is silent. An extra optional field is accepted by
every daemon ever released.

### 2. File transfer flow control and completion

| Change | Detail |
|---|---|
| Server feature flag | `fileTransferAck` in `server_info.features` |
| New push `file_upload_complete` | `{ type, transferId, stream, ok, bytesWritten, error? }`, sent to the uploading session once the daemon has closed the target file or failed. Sent only when the client asked for it |
| `file_upload_request.ack` | New optional boolean. `true` requests the completion push |
| `Transport.bufferedAmount` | New optional read-only number: bytes queued and not yet sent |
| `FileTransferClient.upload` | Accepts a chunk source (bytes, a `Blob`, or an async iterable of `Uint8Array`) plus optional `{ onProgress, signal }`. Pauses while the transport's buffered amount is above a high-water mark. With `fileTransferAck`, resolves on `file_upload_complete` and rejects on `ok: false` |
| Daemon download | Pauses the read stream while the session's socket buffer is above a high-water mark |
| Daemon download error | Sends `Error` and stops; no trailing `End` |
| Daemon upload streams | A binary upload frame is accepted only from the session that requested the stream |

Compatibility:

| Client | Daemon | Behaviour |
|---|---|---|
| New | New | Paced upload, daemon-confirmed completion |
| New | Old (no flag) | Paced upload, resolves when the last frame has left the buffer |
| Old | New | Unchanged: no `ack`, no push |

The chunk size (32 KiB), the frame opcodes and the token flow do not change.

### 3. Fixtures

New fixtures, each validated like the existing ones:

| Family | Messages |
|---|---|
| File transfer RPCs | `file_download_token_request`/`_response`, `file_download_request`/`_response`, `file_upload_request`/`_response`, `file_upload_complete` |
| Terminal RPCs | `create_terminal_request`/`_response`, `subscribe_terminal_request`/`_response`, `list_terminals_request`/`_response`, `kill_terminal_request`/`_response`, `rename_terminal_request`/`_response`, `capture_terminal_request`/`_response`, `terminals_update` |
| Handshake | `hello` variant carrying `platform` |
| Binary frames | File transfer `Begin`, `Chunk`, `End`, `Error`; terminal `Output`, `Input`, `Resize`, `Snapshot`, `Restore` |

Binary fixtures use a new file shape and their own manifest, so `manifest.json` and its
`formatVersion` are untouched. **As built they live in a `binary/` subdirectory with `binary/manifest.json`**
(not a top-level `binary-manifest.json`), because the dashboard's vendored-fixture test fails on any
top-level `*.json` that `manifest.json` does not list; `direction` is `"both"` for the four
file-transfer frames (valid for downloads and uploads):

```jsonc
// binary/manifest.json: { "formatVersion": 1, "frames": [{ "file", "family", "opcode", "direction" }] }
{
  "family": "file_transfer",          // | "terminal"
  "opcode": "Chunk",
  "direction": "server_to_client",
  "description": "…",
  "since": "0.0.118",
  "hex": "11 00 68 69",               // the complete frame, bytes as hex
  "decoded": { "opcode": "Chunk", "stream": 0, "dataHex": "68 69" }
}
```

## Behavior & algorithms

### Paced upload (SDK)

```
upload(path, source, { onProgress, signal }):
    response = request file_upload_request { path, transferId, ack: serverHas(fileTransferAck) }
    send Begin
    for each chunk of source, at most 32 KiB:
        if signal aborted: send Error; reject with AbortError
        while transport.bufferedAmount > HIGH_WATER: wait briefly
        send Chunk; onProgress(bytesSent, total)
    send End
    if ack requested: await file_upload_complete for transferId; reject when ok is false
    else: wait until transport.bufferedAmount is 0 (or unknown), then resolve
```

A transport without `bufferedAmount` is treated as never congested, which is today's behaviour.

### Paced download (daemon)

```
on each chunk read from disk:
    send Chunk
    if socket buffered amount > HIGH_WATER: pause the read stream
        resume when the buffer falls below LOW_WATER
on read error: send Error; stop
on end: send End ok
```

A session whose socket does not expose a buffered amount (the relay path, if it does not) is not
paced.

### Web client

`web-client`'s upload passes the `File` itself as the chunk source instead of calling
`arrayBuffer()`, so a large upload no longer needs the whole file in memory. This lands in the
browser host's `files.upload`.

## Data & persistence touchpoints

None. No stored entity changes.

## Error handling & edge cases

| Condition | Expected behavior |
|---|---|
| Daemon write fails mid-upload, `ack` requested | `file_upload_complete { ok: false, error }`; the partial target file is closed. Whether it is deleted is a TODO(verify) |
| Connection drops mid-upload | SDK rejects; daemon closes the handle and frees the stream. No resume |
| Upload aborted through `signal` | SDK sends `Error`, rejects with an abort error; daemon closes and frees the stream |
| Upload frame for a stream owned by another session | Ignored |
| `file_upload_request` with `ack: true` to a daemon without the flag | The SDK never sends it: it checks the flag first |
| Zero-byte upload | `Begin`, `End`; completion reports `bytesWritten: 0` |
| Download read error | `Error` frame only |
| Client stops reading during a download | Daemon pauses reading from disk; memory stays bounded |
| `hello.platform` longer than a sane bound or not a string | Dropped; the handshake still succeeds |

## Dependencies on other specs

- [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md): append-only rule;
  every change here is a new optional field, a new message or a new feature flag.
- [../architecture/external-client-fixtures.md](../architecture/external-client-fixtures.md): the
  new fixtures follow its format, its two test layers and its breaking-change policy.
- [../architecture/workbench-host-adapter.md](../architecture/workbench-host-adapter.md): the
  browser host's `files.upload` is where the paced, streaming upload is used.

## Non-goals

- Transfer resume after a dropped connection.
- A different chunk size or a new transfer transport (HTTP, a dedicated socket type).
- Rules for a client holding two connections. A second connection is an ordinary session.
- Changing `clientType`.

## Acceptance criteria

- [x] A `hello` with `platform: "desktop"` and `clientType: "browser"` is accepted by the current
      daemon and by a 0.0.117 daemon; the current daemon reports `platform` in `daemon_status`.
      *(0.0.117: checked against the published `@av-pi-studio/server@0.0.117`. Current: unit test, and
      a `desktop` session listed in `daemon_status_request` on a live production daemon.)*
- [x] Uploading a file several times larger than the SDK's high-water mark over a throttled socket
      keeps the transport's buffered amount bounded; a test asserts the bound.
      *(`file-transfer-upload.test.ts`: "never queues more than the high-water mark plus one frame".)*
- [x] With `fileTransferAck`, `upload()` resolves only after `file_upload_complete`, and the file
      on disk has exactly the uploaded bytes at that moment. *(Scripted-transport test, and
      `cli/src/file-transfer-sdk-e2e.test.ts` against a real dev daemon.)*
- [x] A daemon-side write failure rejects `upload()` with the daemon's error.
- [x] Against a daemon without the flag, `upload()` still completes and writes the correct bytes.
- [x] Aborting an upload leaves no open handle and no occupied stream on the daemon. *(Abort sends an
      `Error` frame; the daemon reports it as a failed completion and frees the stream; a closed
      session frees its streams.)*
- [x] A download to a client that reads slowly keeps the daemon's socket buffer bounded; a test
      asserts the bound. *(`file-transfer.test.ts`. Also seen live: a 600 MiB download to a paused client
      grew the daemon's RSS by ~58 MB.)*
- [x] A download read error produces an `Error` frame and no `End`.
- [x] An upload frame sent from a session that does not own the stream is ignored.
- [x] `web-client` uploads a file larger than 500 MB without holding it in memory, and the Files
      tree shows it afterwards. *(Live: a 600 MiB file through the Files explorer; JS heap stayed at
      14–19 MB, the SHA-256 matched, the file appeared in the tree. Renderer RSS rises transiently with
      the 32 KiB slices until V8 collects, and returned to baseline after a forced GC.)*
- [x] Every message and binary frame in the Fixtures table has a fixture; the existing fixture
      tests cover them; `manifest.json`'s `formatVersion` is unchanged. *(Binary frames live in
      `fixtures/external-clients/binary/` with their own manifest.)*
- [x] `docs/desktop-client-handoff.md`, `packages/protocol/AGENTS.md`,
      `packages/client/AGENTS.md`, `packages/server/AGENTS.md`, the fixtures `README.md` and the
      root `AGENTS.md` protocol section are updated in the same change.

## TODO(verify)

- ~~**Dev daemon coverage.**~~ Resolved (task-006): the dev bootstrap now registers the file-transfer
  and terminal handlers (and their binary handlers), wired as in production; the live fixture test
  covers them.
- ~~**Buffered amount on the relay path.**~~ Daemon side resolved (task-002): the relay session's
  stand-in socket has no queue to read (`Session.bufferedAmount` is `undefined`), so relay
  downloads are unpaced and the spec's bounds apply to direct connections only. **The client's relay
  transport does report it** (task-004): `relay-transport.ts` returns its relay socket's
  `bufferedAmount`; the channel encrypts and writes synchronously, so the queue is the base64-inflated
  ciphertext. Verified by reading `relay-transport.ts` and `relay/src/channel.ts`; there is no
  relay-specific test. Relay **uploads** are therefore paced, relay **downloads** are not.
- ~~**Direct-connection behaviour on an invalid `hello`.**~~ Resolved: the daemon closes the socket
  with 1008 `first frame must be hello`; only the relay path ignores it silently. Recorded in the
  handoff doc.
- ~~**Partial file after a failed upload.**~~ Decided (task-003): it is **left** on disk, as before;
  `file_upload_complete { ok: false }` tells the client it is partial.
- ~~**Binary fixtures and the dashboard.**~~ Checked against `../pi-studio-dashboard` (task-007): the
  vendoring is a wholesale `rsync -a --delete`, but its `vendored_fixtures.rs` fails on any top-level
  `*.json` (other than `manifest.json`) that the manifest does not list. So the binary fixtures are in
  a `binary/` subdirectory, which the dashboard's flat `read_dir` filter ignores. New JSON fixtures are
  fine: that test only requires them to be listed and to decode as generic frames.
- **High- and low-water marks.** Daemon download: 1 MiB high, 256 KiB low, polled every 10 ms.
  **Chosen, not measured** (no LAN/relay measurement was run); injectable through
  `FileTransferDeps`. SDK upload: `UPLOAD_HIGH_WATER_BYTES` = 1 MiB, 10 ms poll, also chosen, not
  measured. A daemon without `fileTransferAck` cannot confirm the file reached disk: the SDK
  resolves once its transport buffer drains after `End`.
  **Live check (task-008, loopback, isolated production daemon):** 600 MiB each way — upload from the
  Files explorer in ~5 s, download to a TCP-paused client with ~58 MB daemon RSS growth, then a
  matching SHA-256. LAN, relay and slower links were not measured; the relay path was not run live
  (unit tests and code reading only).
