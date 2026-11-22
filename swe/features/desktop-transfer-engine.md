# Feature — Desktop Transfer Engine

> **Status: specified 2026-11-22, revised the same day, planned as sprints 118–123. Nothing
> built.** Milestone 3 of the desktop client. Decisions D1–D20 are the owner's, from the grill
> ([../grills/desktop-transfer-engine.md](../grills/desktop-transfer-engine.md), confirmed
> 2026-11-22). S1–S12 were proposed in this document; the owner asked for the plan without
> changing one. The owner then said that **compatibility is not a concern** (nobody uses the
> project yet) and that a better design may break it: R1–R4 follow from that, S6 is withdrawn, and
> D4, D14, D15 and D20 are changed where the tables say so.

> Part of: [../MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Dependencies: [../architecture/workbench-host-adapter.md](../architecture/workbench-host-adapter.md)
> (`files`, amended here), [file-explorer-transfer.md](file-explorer-transfer.md) (the wire flow and
> the explorer's status line, amended here), [desktop-transport-bridge.md](desktop-transport-bridge.md)
> (the dial, the secret store, the resume signals, `ui.inspect`), [desktop-native-host.md](desktop-native-host.md)
> (save to disk, transfers in flight, the page's command list), [desktop-daemon-registry.md](desktop-daemon-registry.md)
> (the current entry, switching), [desktop-client-protocol-followups.md](desktop-client-protocol-followups.md)
> and [desktop-client-protocol-followups-2.md](desktop-client-protocol-followups-2.md) (the wire this
> uses unchanged), [../architecture/websocket-protocol.md](../architecture/websocket-protocol.md)
> Desktop rules: `desktop/AGENTS.md`, `desktop/docs/architecture.md`

## Purpose

Today every byte of a file transfer goes through the page. An upload is read by the page and sent
on the page's socket: a 1 GiB upload grows the page by about 2 GiB on WebKitGTK. A save arrives on
the page's socket and crosses Tauri's IPC to Rust chunk by chunk. Both share one socket with the
terminal and the chat.

This feature moves uploads and saves into Rust, on a second connection to the daemon that Rust
opens for them. The page asks, shows progress and can cancel; it never holds the bytes. The check
for the whole feature: a 5 GiB file moves both ways with flat memory while a terminal stays
responsive (D16).

Not in this feature (D1–D5, D8, D15): viewers served by Rust (`files.openForView` keeps `Blob`
URLs), transfers of a relay entry (milestone 4), native file drops, any change to the wire, upload
resume, a transfers list, uploading a folder, a transfer that survives quitting, and any path for
a daemon older than the app (R1).

## Decisions

Owner, 2026-11-22 (the grill; its rationale is in the brief):

| # | Decision |
|---|---|
| D1 | Uploads and saves move to Rust. Viewers keep `Blob` URLs |
| D2 | Only `local` and `direct` entries. A relay entry keeps today's path through the page until milestone 4 |
| D3 | A native picker for the Upload button. A file dropped on the window keeps today's path through the page |
| D4 | No change to the wire. A failed upload starts again from zero. (The grill also said "no change to the daemon"; R3 and R4 change the daemon's behaviour, not its wire) |
| D5 | After a dropped connection the engine continues by itself while the app runs: a download resumes, an upload restarts. Nothing survives quitting |
| D6 | The bulk connection is opened by the first transfer and closed after a short idle time. It is a second session, with `agentStreams: "none"` |
| D7 | Up to 3 transfers at once on the one connection; the rest wait in order |
| D8 | The explorer's status line shows a percentage for uploads and for saves, with a Cancel control, in the browser client too |
| D9 | A download is written to a temporary file next to the chosen one, renamed when complete, deleted on cancel or final failure (the name: S1) |
| D10 | Switching daemon or closing the window while transfers run asks first; "yes" cancels them |
| D11 | One status line per activity. A picked batch is one activity (its files one after another, one percentage, one Cancel); each save is its own |
| D12 | The engine retries until the user cancels or the window leaves the entry. An error a retry cannot fix fails at once |
| D13 | A download that resumes onto a changed file fails; no automatic restart |
| D14 | ~~A cancelled or failed upload leaves the partial file on the daemon, as today~~ Replaced by R3 |
| D15 | Fourteen edge cases, in § Error handling & edge cases. One is dropped by R1 (an older daemon), one changed by R3 (a changed local file leaves nothing on the daemon) |
| D16 | The check: a 5 GiB upload and a 5 GiB save on Linux over loopback, with pass marks (§ Acceptance criteria) |
| D17 | Live on Linux; the automated suites on the macOS and Windows runners; manual macOS and Windows steps as open rows in `desktop/docs/platform-checks.md` |
| D18 | A launch option forces the page's path. No setting in the UI |
| D19 | `ui.inspect` gains a transfers section; the app logs the start, end and failure of each transfer with both paths, never a password |
| D20 | The page names a local file only by a handle Rust issued; Rust connects only to the current entry; what the daemon sends is hostile; the Rust protocol code is tested against the published fixtures. ("The host contract only gains optional members" is replaced by R2) |

Owner, 2026-11-22, after the first version of this document: compatibility with older daemons,
apps and clients is not a concern, and a better design may break it. What changes:

| # | Change | Why |
|---|---|---|
| R1 | **Drops a row of D15 and S6.** There is no path for an older daemon. The engine serves every `local` and `direct` entry; a daemon that lacks a flag the engine needs fails the transfer with `unsupported_daemon`. The app's `minDaemonVersion` becomes the release that carries R3 and R4 | The fallback needed the page to read the daemon's flags off its own socket before the picker opens. Without it the host's choice is fixed for the life of a page |
| R2 | **Replaces part of D20.** The host contract changes freely: `UploadOptions` is renamed `TransferOptions` with no alias, `saveToDisk` takes it as a second argument, and every host and test host is updated in the same change | One name for one thing; no member kept for an old caller |
| R3 | **Replaces D14.** The daemon writes an upload to a temporary file beside the target (`.pistudio-upload-<32 hex>.part`) and renames it over the target when the upload is complete. A failed, cancelled or abandoned upload leaves nothing, and a file it would have replaced keeps its old content. Both clients get this | The daemon truncated the target at the first byte, so a failed overwrite destroyed the old file, and an upload that restarts after a drop (D5) left halves behind. The wire is unchanged |
| R4 | The daemon paces an upload: it stops reading the session's socket while more than 1 MiB of that upload waits to be written to disk, and reads again under 256 KiB (the download's marks) | It queued writes without a bound, so a fast sender and a slow disk grew its memory by the size of the file. The wire is unchanged: the sender is slowed through TCP, which the SDK's `bufferedAmount` pacing and the engine's awaited writes already obey |

Proposed in this document. The owner asked for the plan on 2026-11-22 without changing one, which
is taken as acceptance; S6 is withdrawn (R1) and S7 is shortened (R2):

| # | Proposal | Why |
|---|---|---|
| S1 | **Changes D9 and two rows of D15.** The temporary file is the one saves already use: `.pistudio-save-<32 hex>.part` beside the destination, listed in `pending-saves.json`, removed at the next launch if a crash left it (`crates/shell/src/saves.rs`). Not `name.part`. So "an existing `name.part` is replaced" does not arise (the name is unique), and a crash's leftover **is** cleaned up | The mechanism exists, is tested, and does more than the grill asked. A second naming scheme would be a second convention |
| S2 | A new crate, `pistudiodesktop-transfer`, at a new layer 8, holds the engine. It may use `net`; the rule "only an app binary may use `net`" becomes "only `transfer` and an app binary" | The engine speaks the daemon's protocol and schedules transfers: several thousand lines that must be tested without Tauri. `net` stays the only crate that opens a socket |
| S3 | Values, chosen and not measured: the bulk connection closes after 30 s idle; it sends a JSON `ping` after 10 s without a frame from the daemon and counts as dropped after 30 s without one; a reconnect waits 1 s, doubling to 30 s; an RPC answer is awaited 30 s; the socket's message limit is 16 MiB; a download holds at most 1 MiB that is not yet on disk | They close the grill's two open values. 30 s without a frame is how "no byte moves for 30 s" (D15) is observed: an upload gets no frame back until it completes, so the ping proves the daemon is there |
| S4 | The launch option is `--transfers <engine\|page>`, default `engine`; the page learns it from `boot` | The shape of `--secret-store` |
| S5 | Four new commands for the page (`upload_pick`, `transfer_upload`, `transfer_save`, `transfer_cancel`) and one event (`transfer_progress`). A transfer command answers when the transfer has settled; the event is advisory | A lost event then costs a stale percentage, never a hung transfer. Listening to events is already granted |
| S6 | ~~The desktop host learns the daemon's feature flags by reading the `status` frame that passes through its proxied transport~~ Withdrawn: R1 | |
| S7 | The host contract's new members: `signal` and `onStateChange` in the options of `upload`, and the same options on `saveToDisk` | D8, D11, D12 |
| S8 | The workbench keeps activities in a small store, and the explorer draws them. A save started from a viewer's toolbar shows there too. At most 4 lines are drawn, then a count | A save has three triggers, and only one of them is in the explorer |
| S9 | An upgrade answered with anything but 101, 401 or 403 (`handshake`) is retried | A reverse proxy answers 502 while its daemon restarts |
| S10 | **Narrows D19.** `ui.inspect` shows no path (as `connection` shows no address). The paths are in the log, and the app's log is standard error: it has no log file (`src-tauri/src/logging.rs`) | The grill's question said "the app's own log file"; there is none |
| S11 | An upload is done only when `file_upload_complete` reports as many bytes as were sent | The one end-to-end check the wire offers |
| S12 | A download asks for everything from its offset in one request, not in 8 MiB ranges | The page needed ranges to bound its memory; the engine bounds it by not reading the socket faster than it writes the disk |

## Public contract

### 1. The launch option and `boot`

`--transfers <engine|page>`, parsed with the app's other options (`src-tauri/src/main.rs`). No
environment variable. `page` turns the engine off for the run: the four commands of § 2 answer
`engine_off`, and the desktop host uses the page's path for everything.

`boot` gains one field: `transfers: "engine" | "page"`.

### 2. The page's commands

Added to the app manifest, the capability and `generate_handler!` (the test of the exact capability
list grows from 16 to 20). The Content-Security-Policy does not change.

| Command | Input | Answer | Errors |
|---|---|---|---|
| `upload_pick` | none | `[{ handle, name, size? }]`; `[]` when the user cancelled | `engine_off` |
| `transfer_upload` | `{ id, handle, path }` | `{ bytes }`, once the daemon confirmed the write | § Error handling |
| `transfer_save` | `{ id, handle, path }` | `{ bytes }`, once the file is renamed into place | § Error handling |
| `transfer_cancel` | `{ id }` | `{ cancelled: true }`, or `{ cancelled: false }` for an id that is not running or waiting | none |

- **`upload_pick`** shows the native open dialog for one or more files, off the event loop, one
  dialog at a time. It starts in the folder used last in this run. For each chosen file Rust
  keeps the path and answers a `handle` (128 random bits as 32 hexadecimal digits), the file's
  `name` (its last path component; a name that is not valid Unicode is sent with replacement
  characters) and its `size` when the file's metadata could be read. A handle works once, for
  `transfer_upload`. Rust keeps at most 1024 unused handles (the oldest is dropped) and drops all
  of them at `boot`.
- **`id`** is chosen by the page: 1 to 64 characters of `A-Z a-z 0-9 -`, not in use by a transfer
  that is running or waiting. It names the transfer in `transfer_progress` and `transfer_cancel`.
- **`transfer_upload`**: `handle` is from `upload_pick`; `path` is the target path on the daemon,
  built by the host as the browser host builds it (`<dir>/<name>`), at most 4096 bytes.
- **`transfer_save`**: `handle` is a save handle from the existing `save_begin` (which shows the
  save dialog and creates the temporary file); `path` is the daemon file. From here the engine owns
  the save: the page calls neither `save_write` nor `save_finish` nor `save_discard` for it. On any
  failure or cancel the engine discards the save.
- The page never sends a local path, and no answer, event or error holds one (D20).
- Rust dials the current entry's stored address and reads its password itself, as `transport_open`
  does. The page sends no address (D20).
- `save_begin`, `save_write`, `save_finish`, `save_discard` and `transfers_set` are unchanged. The
  page's path still uses them (a relay entry, `--transfers page`).

Event `transfer_progress`, emitted to the page:

```
{ id, state: "queued" | "running" | "waiting", done: number, total: number | null }
```

- `queued`: behind three other transfers. `running`: bytes are moving. `waiting`: the bulk
  connection is being opened or reopened.
- `done` is bytes sent (an upload) or bytes written to disk (a save). It goes back to 0 when an
  upload restarts after `waiting`.
- Emitted at every change of `state`, and at most 10 times a second per transfer while bytes move.
  Nothing is emitted when a transfer settles: the command's answer says so.

### 3. The bulk connection

One per app, to the current entry's daemon, owned by Rust. It exists only while a transfer is
running or waiting, and for 30 s after the last one (D6, S3).

| Step | Rule |
|---|---|
| Who | The current entry, asked of the owner thread as `transport_open` asks (`OwnerAccess::bridge_plan`); the password is read from the secret store on the blocking pool. A relay entry answers `not_bridged` |
| Dial | `net::dial` with the 15 s limit and a 16 MiB message limit (a new parameter of the dial; the proxy keeps 128 MiB) |
| `hello` | `{ type: "hello", clientId, clientType: "browser", protocolVersion: 1, platform: "desktop", agentStreams: "none", appVersion: "pistudiodesktop/<version>" }` (fixture `hello.agentStreams.json`, without its `capabilities`: this connection consumes no stream event). `clientId` is random, made once per run of the app, and is not the page's |
| Answer | The first `status` frame with `payload.status: "server_info"`, awaited 30 s. Its `features` must hold `fileDownloadRanges`, `fileTransferAck` and `agentStreamsMode`; otherwise every transfer fails with `unsupported_daemon` and the connection closes |
| Requests | `{ type: "session", message: { type, requestId, … } }`; the answer is the `session` message with the same `requestId`, or an `rpc_error` with it. Awaited 30 s |
| Liveness | After 10 s without a frame from the daemon, Rust sends `{ type: "ping", requestId }`. After 30 s without a frame, the connection counts as dropped. A `ping` from the daemon is answered with a `pong` |
| Everything else | A text frame that is not an awaited answer, `file_upload_complete`, `ping` or `pong` is ignored without being parsed further than its `type`. A binary frame whose opcode is not `0x10`–`0x13`, or whose stream is not a running download, is ignored |
| Close | 1000 after the idle time; 1001 at `boot`, a switch, the window closing and exit |

The connection is not a proxied connection: it does not count against the proxy's four, and
`connection.transports` does not list it.

### 4. An upload on the wire

```
file_upload_request { path, transferId, ack: true }      transferId: a new UUID per attempt
  -> { ok: true, stream } | { ok: false, error }         missing_fields, no_free_stream
Begin  (0x10, stream)  { "transferId": … }
Chunk  (0x11, stream)  at most 32 KiB each, in file order
End    (0x12, stream)  one byte, 1
  <- file_upload_complete { transferId, stream, ok, bytesWritten, error? }
```

Rust reads the local file as it sends, and waits for each write to the socket to complete before
reading on, so it holds a bounded amount whatever the file's size; the daemon slows it through the
socket when its disk is behind (R4). The upload has succeeded when `file_upload_complete` says
`ok: true` and `bytesWritten` equals the bytes sent (S11); only then does the target exist or
change on the daemon (R3). To stop an upload whose `Begin` was sent, Rust sends `Error` (0x13)
with `client_aborted` (a cancel) or `client_error` (anything else), and ignores the
`file_upload_complete` that follows.

### 5. A save on the wire

```
file_download_request { path, stream, offset?, ifUnchanged? }     stream: chosen by Rust, 0-255
  -> { ok: true, stream, transferId, totalBytes, mtimeMs, offset, length } | { ok: false, error }
Begin (0x10)  Chunk (0x11) ...  then End (0x12) or Error (0x13)
```

The first request has no `offset`. A resume sends `offset` = the bytes already in the temporary
file and `ifUnchanged: { size, mtimeMs }` from the first answer (D5). There is no `length`: the
daemon sends to the end of the file (S12). Chunks are written to the save's temporary file in
order; Rust stops reading the socket while more than 1 MiB of a download is not yet on disk. The
save has succeeded when `End` arrives and exactly `length` bytes came; then the file is flushed and
renamed over the destination. To stop a download Rust sends `file_download_cancel_request { stream }`
and keeps the stream id reserved until the daemon's last frame, a refusal, or the connection's end.
An `Error` frame may be a stream's first and only frame.

### 6. Host members

`HostFiles` (`packages/workbench/src/host/types.ts`) changes; every host and the test host change
with it (R2, S7):

```ts
type TransferState = "queued" | "running" | "waiting";

interface TransferOptions {                           // replaces UploadOptions
  onProgress?(done: number, total?: number): void;   // restarts from 0 after "waiting"
  onStateChange?(state: TransferState): void;        // a host that never calls it is "running"
  signal?: AbortSignal;                              // aborting rejects with an AbortError
}

upload(dir: string, source: UploadSource, options?: TransferOptions): Promise<void>;
saveToDisk(path: string, options?: TransferOptions): Promise<void>;
pickUploads?(): Promise<UploadSource[]>;             // present or absent for the life of the page
```

A host calls neither callback of a save before the user has chosen a destination.

| Host | `upload` | `saveToDisk` | `pickUploads` |
|---|---|---|---|
| Browser | As today; `signal` goes to the SDK's `upload` | As today (a `Blob` and an anchor, or the `saveTarget` ranges); progress from the SDK's `onProgress` and the answer's `totalBytes`; `signal` goes to the SDK, and an abort discards the save target | Absent |
| Desktop, engine serves | A picked source: `transfer_upload`. A `Blob` (a dropped file, a file the workbench made): the browser host's | `save_begin`, then `transfer_save` | Present: `upload_pick` |
| Desktop, engine does not serve | The browser host's | The browser host's (with `saveTarget`) | Absent: the workbench uses its file input |

**The engine serves** when `boot` said `transfers: "engine"` and the current entry is of kind
`local` or `direct`. Both are fixed for the life of a page (a switch reloads it), so the host
decides once, when it is built (R1).

A picked source is an object the desktop host made, holding the handle where the workbench cannot
see it.

`countTransfers` keeps wrapping `upload` and `saveToDisk`, so the page's count (`transfers_set`)
covers engine transfers as well: each is a pending call of the host.

### 7. What the user sees (both clients)

The workbench keeps **activities** in one store (S8). The Files explorer draws them where its
status line is, one line each, oldest first, at most four and then "and N more":

| Activity | Starts | Line | Cancel |
|---|---|---|---|
| A batch of uploads | After the overwrite question | `Uploading N files… P%`; no percentage when a size is unknown | Aborts the file being sent and starts none of the rest |
| A save | At the first `onProgress` or `onStateChange` of the host | `Downloading <name>… P%` | Aborts it |

- State `waiting` replaces the percentage with `waiting for the connection`; `queued` with
  `waiting`.
- A line changes only when its text does. Its Cancel control is a button with the accessible name
  `Cancel: <the line's label>`.
- When an activity ends, its line goes, and the explorer's one transient status says what
  happened: `Uploaded N files`, `Downloaded <name>`, `Upload cancelled`,
  `Download cancelled`, or `Upload failed: <message>` / `Download failed: <message>`
  as an error. A cancelled or failed upload leaves nothing on the daemon (R3).
- A save started outside the explorer (a viewer's toolbar, the PDF toolbar) is an activity too.
  Those places keep their own feedback (the spinner, the alert on failure) but stay silent for a
  cancel.
- Activities live in the page. A reload ends them, with their transfers.

### 8. What the control socket sees, and the log

`ui.inspect` gains `transfers` (D19, S10), filled by the app through a hook, as `connection` is:

```
transfers: {
  mode: "engine" | "page",
  connection: { state: "closed" | "connecting" | "open" | "waiting", entryId: string | null, opens: number },
  active: [ { id, kind: "upload" | "save", state: "running" | "waiting", bytesDone, bytesTotal: number | null, restarts } ],
  queued: number,
  totals: { done, failed, cancelled },
  peakHeld: number,
  lastError: { code, atMs } | null
}
```

No path, no address, no handle, no secret. `opens` counts how often the bulk connection was opened
in this run; `restarts` how often that transfer continued after a drop; `peakHeld` is the most
bytes the engine held for transfers, in memory, at one moment (the memory criterion reads it).

The log (standard error, level info) gets one line when a transfer starts, ends or fails: its id,
kind, the daemon path, the local path, the bytes, the duration, and the error code if any. Never a
password, a handle or file content.

### 9. Where the code lives

| Piece | Place | Rule |
|---|---|---|
| The daemon's protocol as the engine uses it (envelopes, the file-transfer frames), the bulk connection, the upload and the download, the queue, the retry | New crate `pistudiodesktop-transfer`, layer 8, native only, empty on wasm32; depends on `net` and on nothing with a UI (S2); registered in `xtask/src/layers.rs` | Local files are behind two traits (a source to read, a sink to write, finish and discard) that the app implements. Tested without Tauri: against the published fixtures, against a stand-in daemon in the test process, and with hostile input |
| The dial's message limit | `crates/net` | A parameter; the proxy passes today's value |
| The save sink, the refusal of a second save into one destination | `crates/shell/src/saves.rs` | The engine writes through `Saves`: the same temporary file, journal, finish and discard (S1) |
| The picked files, the transfers view and its hook, the launch choice | `crates/shell` | Plain data; no socket type |
| The four commands, the event, the wiring to `boot`, a switch, the window, exit and the resume signals | The app binary (`src-tauri/src/transfers.rs`) | Runs on Tauri's async runtime; file and store calls on the blocking pool; nothing on the owner thread but the question for the current entry |
| The engine-backed `files` members | `desktop/apps/pistudiodesktop/src/host/` (`transfers.ts`, `desktop-host.ts`) | The package still opens no socket itself |
| The contract, the browser host's cancel and progress, the activities and their lines | `packages/workbench` | One UI for both clients; `workbench-host-adapter.md` and `file-explorer-transfer.md` are amended in the same tasks |
| The upload's temporary file and its pacing (§ 10) | `packages/server/src/files/file-transfer.ts`, `packages/server/src/ws/session.ts` | The wire and the fixtures' shapes do not change; the fixtures' notes and the root `AGENTS.md` say "nothing is left" where they said "a partial file is left" |

`desktop/docs/architecture.md`'s sentence "only an app binary may use `net`" becomes "only
`transfer` and an app binary".

### 10. The daemon (R3, R4)

Two changes of behaviour in `FileTransferService`; no message and no frame changes.

| Step of an upload | Today | With this feature |
|---|---|---|
| `Begin` | Creates the target's directory, opens the target with `"w"` (truncating it) | Creates the directory, creates `.pistudio-upload-<32 hex>.part` in it (exclusively) |
| `Chunk` | Appends to the target | Appends to the temporary file |
| `End` | Closes; `file_upload_complete { ok: true }` | Closes, renames the temporary file over the target, then `file_upload_complete { ok: true }`. A failed rename is `rename_failed (<errno>)` |
| `Error` from the client, a failed write, the session closing | Closes; the partial target stays | Closes and removes the temporary file; the target is as it was before the upload |

**Pacing.** Each upload counts the bytes of its `Chunk`s that have arrived and are not yet
written. While any upload of a session has more than 1 MiB waiting, the daemon does not read that
session's socket; it reads again when every upload of the session is under 256 KiB. `Session`
gains the two calls that stop and continue reading its socket. A session that closes while
stopped is released like any other.

A daemon that dies during an upload leaves the temporary file; nothing removes it (§ TODO).

## Behavior & algorithms

### The queue

```
start(transfer):
    refuse: engine off, bad id, id in use, unknown handle, destination of a running save
    add to the end of the queue; emit queued unless it can run now
    run()

run():
    while fewer than 3 transfers are active and the queue is not empty:
        take the first; make it active
    if any transfer is active and the connection is closed: open()

settle(transfer, outcome):          # done, failed with a code, or cancelled
    answer its command; log a line; count it; release its file or save
    run()
    if nothing is active or queued: start the 30 s idle timer; when it fires, close 1000
```

A new transfer stops the idle timer.

### The connection and its recovery (D5, D12, S3, S9)

```
open():
    every active transfer -> waiting (event)
    plan = the current entry (owner thread); password (blocking pool)
    dial, hello, wait for server_info
    final error  -> settle every active and queued transfer as failed with that code; closed
    other error  -> wait(next delay: 1 s, 2 s, 4 s … 30 s), then open() again
    ok           -> delay back to 1 s; every active transfer starts or continues:
                        an upload from byte 0, with a new transferId
                        a save from the bytes in its temporary file, with ifUnchanged

wait(delay) ends early when:
    the app emits connection_resume (wake, network change)
    transport_open succeeds for the same entry (the daemon is back for the page)
    nothing is active any more (everything was cancelled): closed

dropped (the socket ended, a write failed, 30 s without a frame):
    forget every stream id; open()
```

Final errors: `unauthorized`, `host_not_allowed`, `tls`, `invalid_address`, `secret_missing`,
`secret_unavailable`, `not_bridged`, `no_current`, `unsupported`, `unsupported_daemon`, `protocol`.
Everything else that stops the connection from opening is retried: `unreachable`, `timeout`,
`handshake`, a local daemon that is stopped or starting. There is no limit on the number of
attempts (D12).

### The desktop host's choice

```
built once, with the host:
    engine serves  -> files.pickUploads = pick; upload and saveToDisk as below
    otherwise      -> the browser host's files, unchanged (no pickUploads)

pick():                  sources = upload_pick(); remember each source's handle

upload(dir, source, options):
    source is a picked one -> run(transfer_upload { id, handle, path: dir + "/" + source.name }, options)
    else                   -> the browser host's upload

saveToDisk(path, options):
    handle = save_begin(the file's name)        # null: the user cancelled; resolve
    run(transfer_save { id, handle, path }, options)

run(command, options):
    id = a new random id; listen for transfer_progress with this id -> onStateChange, onProgress
    options.signal aborts -> transfer_cancel { id }
    await the command: answer -> resolve; error cancelled -> reject AbortError; else reject Error(message)
```

### Leaving

| Event | The engine |
|---|---|
| `boot` (a reload) | Cancels every transfer, closes the connection, drops the picked files. The old page's commands are gone with it |
| A daemon switch, after the user said yes | The same, before the reload |
| The window closes, after the user said yes | The same |
| Exit | The same, waiting at most as long as the proxied connections' close does |

The question itself is unchanged: it reads the page's count, which includes engine transfers (§ 6).

## Data & persistence touchpoints

| File or store | Change |
|---|---|
| The transfers, the queue, the picked files, the bulk connection | In Rust's memory, for one run. Nothing is stored |
| `.pistudio-save-<32 hex>.part` beside a destination | As for saves today; now written by the engine. Removed on cancel and on a final failure; kept while a save waits for the connection |
| `pending-saves.json` | Unchanged: lists open saves so that a launch can remove what a crash left (S1) |
| `daemons.json`, `settings.json`, the secret store, `daemon-state/*.json` | Unchanged. The password is read, never written |
| The daemon | No new stored state. The bulk connection is one more session, shown in `daemon_status` as a `browser` client with `platform: "desktop"` and `agentStreams: "none"`. While an upload runs, `.pistudio-upload-<32 hex>.part` exists in the target's directory (R3) |

## Error handling & edge cases

Errors of `transfer_upload` and `transfer_save`, as `{ code, message }`. `message` is written for a
person; it may name the daemon's host and the daemon's reason, never a local path, a password or a
handle:

| Code | When |
|---|---|
| `cancelled` | `transfer_cancel`, or the engine left (§ Leaving). The host turns it into an `AbortError` |
| `engine_off` | `--transfers page` (a host bug: it should not have asked) |
| `invalid_request` | A bad `id` or `path` |
| `duplicate_id` | The `id` is running or waiting |
| `unknown_handle` | No such picked file or open save, or it was used already |
| `destination_busy` | Another save is writing to the same destination (D15); the second save is discarded |
| `source_unreadable` | The local file could not be opened or read; the message carries the system's reason (D15) |
| `source_changed` | The local file's size changed during the upload (D15). Nothing is left on the daemon (R3) |
| `disk` | Writing, flushing or renaming failed on this machine; the message carries the system's reason. The temporary file is removed (D15) |
| `changed` | The daemon answered `changed` to a resume, or sent `Error` `changed`. Message: "The file changed on the daemon." (D13) |
| `daemon_refused` | The daemon answered `ok: false`, sent an `Error` frame, or reported a failed write in `file_upload_complete`; the message carries its reason (`not_found`, `not_a_file`, `unreadable`, `no_free_stream`, `write_failed (ENOSPC)`, …) |
| `size_mismatch` | `file_upload_complete` reported another byte count than was sent (S11) |
| `protocol` | The daemon broke the protocol: a frame out of order, more bytes than announced, a message above 16 MiB, an answer of the wrong shape |
| `unsupported_daemon` | `server_info` lacks `fileDownloadRanges`, `fileTransferAck` or `agentStreamsMode`: the daemon is older than the app supports (R1) |
| `unauthorized`, `host_not_allowed`, `tls`, `invalid_address`, `secret_missing`, `secret_unavailable`, `not_bridged`, `no_current`, `unsupported` | As for `transport_open`, when the bulk connection opens or reopens |
| `internal` | Anything the engine did not expect. Never a panic |

| Condition | Expected behavior |
|---|---|
| Any size, down to an empty file | Through the engine; no threshold (D15). An empty save is `Begin`, `End` and an empty file |
| The picker | Files only (D15) |
| A file dropped on the window; a file the workbench made itself | A `Blob`: the page's path, as today (D3) |
| A relay entry; `--transfers page` | The engine does not serve: the file input, the page's upload, the page's save (D2, D18) |
| A daemon older than the app supports | No other path: the transfer fails with `unsupported_daemon`, and the workbench's outdated-daemon notice already names both versions (R1) |
| More than 3 transfers | The rest are `queued`, in order; the queue has no limit (D7) |
| The connection drops | `waiting`, then the transfers continue: a save from its bytes on disk, an upload from zero (D5). No limit in time (D12) |
| The machine wakes, or the network changes | The engine tries at once (D15) |
| 30 s without a frame from the daemon | Dropped (D15, S3) |
| Only one of the two connections drops | Independent: the chat reconnecting does not touch a transfer, and the reverse (D15) |
| Cancel while `queued` or `waiting` | At once; a save's temporary file is removed (D15) |
| Cancel of a running upload | `Error` `client_aborted` to the daemon, which removes its temporary file (R3) |
| An upload onto an existing file fails, is cancelled, or restarts after a drop | The old content stays until an upload completes (R3) |
| The password is refused when the connection opens or reopens | Every transfer fails at once with `unauthorized` (D12) |
| The daemon's disk is slower than the sender | The daemon stops reading the session's socket above 1 MiB waiting, so its memory stays bounded and the sender slows down (R4) |
| A transfer slow on this machine's disk | The engine stops reading the socket, so the other transfers on the connection slow down with it |
| The page reloads during a transfer | § Leaving: cancelled |
| The app crashes or is killed during a save | The temporary file is removed at the next launch (S1) |
| A hostile daemon | Sizes are checked before use, counters do not wrap, a broken frame fails that transfer or closes the connection with `protocol`; nothing panics (D20) |

## Dependencies on other specs

- `workbench-host-adapter.md` — `files` changes as in § 6; amended with the build.
- `file-explorer-transfer.md` — the wire is used as it is; the explorer's status line becomes § 7;
  an upload's effect on the daemon's disk becomes § 10.
- `desktop-transport-bridge.md` — the dial (one new parameter), the plan for the current entry,
  the secret store, `connection_resume`, the `ui.inspect` hook pattern. `transport_open` gains one
  side effect: its success ends the engine's wait.
- `desktop-native-host.md` — the save commands and `Saves` are reused; the command list grows by
  four; "Transfers in flight" is unchanged.
- `desktop-daemon-registry.md` — the switch cancels the engine's transfers.
- `desktop-client-protocol-followups.md`, `-2.md` — `fileTransferAck`, `fileDownloadRanges`,
  `agentStreamsMode` and the fixtures the Rust code is tested against.

## Acceptance criteria

For a local or direct entry in the desktop app with the engine on, unless a row says otherwise.

**The check (D16), on Linux over loopback, in the real webview**

- [ ] A 5 GiB file chosen in the native picker is uploaded: the daemon's copy has the same hash;
  `transfers.peakHeld` stayed under 64 MiB and the app's Rust process grew by at most 64 MiB; the
  page grew by at most 32 MiB; the daemon grew by at most 64 MiB (R4).
- [ ] A 5 GiB file on the daemon is saved to disk, with the same marks.
- [ ] Neither is slower than the same transfer with `--transfers page` on the same build and
  machine.
- [ ] While either runs, a key typed in a terminal echoes at most 5 ms later in the median and
  50 ms at the 99th percentile than with no transfer.

**Behaviour**

- [ ] While a transfer runs, `daemon_status` lists a second client of the app with
  `agentStreams: "none"`; 30 s after the last transfer it is gone (D6).
- [ ] Four transfers started together: three run, the fourth is `queued` and starts when one ends
  (D7).
- [ ] A picked batch and two saves show three lines, each with a percentage and its own Cancel;
  the batch's files go one after another (D8, D11).
- [ ] In the browser client a save shows a percentage and Cancel, and an upload has Cancel (D8).
- [ ] During a save the destination holds no partial data; when it completes, the temporary file
  is gone and the destination holds the file (D9, S1).
- [ ] A cancelled save leaves no temporary file. A cancelled upload, a failed one and one whose
  connection was cut leave no file on the daemon, and a file being replaced keeps its old content
  until an upload completes, in the desktop app and in the browser client (D9, R3).
- [ ] An upload to a daemon whose disk is slowed (a test double) keeps the daemon's queue for it
  under 1 MiB plus one chunk, and completes with the right content (R4).
- [ ] The bulk connection is cut during a save: the save continues from its bytes on disk and the
  hash matches. Cut during an upload: the upload starts again and the hash matches (D5).
- [ ] The daemon is stopped during a transfer: the line says it is waiting for the connection, and
  the transfer continues once the daemon is back, without a limit in time (D12).
- [ ] The daemon file is modified while a save waits: the save fails with "The file changed on the
  daemon." and its temporary file is gone (D13).
- [ ] A password the daemon refuses: the transfer fails at once with `unauthorized` and is not
  retried (D12).
- [ ] With a transfer running, a daemon switch and a window close ask first; "yes" cancels it
  (D10).
- [ ] A relay entry, a dropped file and `--transfers page` each take the page's path and work as
  before; with a relay entry and with `--transfers page` the Upload button opens the file input
  (D2, D3, D18).
- [ ] A daemon without one of the three flags: the transfer fails with `unsupported_daemon` (R1).
- [ ] No command takes a local path, and a `transfer_upload` with a handle Rust did not issue is
  refused (D20).
- [ ] `ui.inspect`'s `transfers` shows a running transfer's bytes and the last error, with no
  path; the log has one line per start, end and failure, with both paths and no password (D19,
  S10).
- [ ] A `secret_guard`-style test finds no password and no handle in any answer, event or log line.

**Tests and machines**

- [ ] The Rust protocol code passes against the published file-transfer fixtures, JSON and binary,
  and against the `hello.agentStreams.json`, `status.server_info.json`, `ping.json`, `pong.json`
  and `rpc_error.json` fixtures (D20).
- [ ] The engine's tests run against a stand-in daemon in the test process: both directions, a
  drop at every stage, a cancel at every stage, and hostile frames; none panics.
- [ ] `cargo xtask ci` passes, including the layer check with the new crate and the wasm check.
- [ ] Live on Linux; the automated suites pass on the macOS and Windows runners; the manual steps
  are rows of a milestone 3 section in `desktop/docs/platform-checks.md` (D17).

## TODO(verify)

- [ ] The values of S3 are chosen, not measured. The check's run should report how often the
  liveness limit and the 1 MiB hold were reached.
- [x] R4 stops reading a session's socket. Measured in sprint-118/task-003 with the daemon's
  writes slowed to about 28 MiB/s: another request on the same connection waits about 0.15 s in
  the median and 0.25 s at most (0.5 s over a relay), and a second client over the same relay is
  not slowed (0.25 ms in the median, as when idle). On a disk faster than the sender, reading
  stopped 3 times in 600 MiB. Left as it is: the engine's uploads run on their own connection,
  so only the browser client's one connection sees the delay.
- [ ] R3's temporary file is visible in the explorer while an upload runs (seen in
  sprint-118/task-003: the listing shows `.pistudio-upload-<hex>.part` and drops it when the
  upload ends), and a daemon that dies leaves it. Decide whether the listing hides the pattern
  and whether the daemon removes old ones at start.
- [ ] A command that stays unanswered for hours (a transfer that waits overnight, D12): confirm on
  the three webviews that its answer still arrives after a sleep. If it does not, the settlement
  moves into `transfer_progress` and the commands answer at once.
- [ ] `minDaemonVersion` (R1) names a release that does not exist yet: set it when the daemon
  changes are released, and release them before or with the app.
- [ ] The native open dialog has never been shown by this app (`platform-checks.md` N3 notes the
  missing picker). Its behaviour on macOS and Windows is unverified.
- [ ] How the 5 GiB check drives the native picker and reads the page's memory in the headless
  container (milestone 2 drove the save dialog with `xdotool` in `pi-desktop-xvfb`).
- [ ] Whether the runner scripts can run a transfer through the page on macOS (no WebDriver
  there). If not, the runners cover the engine through the Rust tests only.
- [ ] Where standard error goes when the app is started from the desktop on each system, since the
  log now carries file paths (D19).
- [ ] `hello.appVersion`: the fixture's form (`pistudiodesktop/<version>`) is used; confirm it is
  what the page sends, so that `daemon_status` shows the two connections alike.
- [ ] A saved file gets the time of the save, not the daemon file's `mtimeMs`, as today. Not asked
  in the grill.
