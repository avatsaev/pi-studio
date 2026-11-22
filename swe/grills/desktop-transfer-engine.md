# Grill — Desktop transfer engine (milestone 3)

> Status: grilling
> Started: 2026-11-22   Last updated: 2026-11-22   Rounds: 4
> Engineer: avatsaev   Agent: Claude (omp)

## Raw idea

"commit and let's grill", where the subject is milestone 3 of `docs/desktop-client-handoff.md`
§ Suggested milestones:

> **Transfer engine.** Upload and download by path on the bulk connection. Check: a multi-gigabyte
> file moves both ways with flat memory use while a terminal stays responsive.

and the handoff's recommended design (§ 2. File transfer engine): a second daemon connection owned
entirely by Rust; upload by local path and download to a local path, streaming with backpressure,
the bytes never entering the webview; progress and cancel exposed through the host adapter; a
native URL (a custom protocol served by Rust) for viewers instead of a `Blob` object URL.

## Codebase context

| Area | Path(s) | Fact that matters |
|------|---------|-------------------|
| Host contract | `packages/workbench/src/host/types.ts` | `files.upload(dir, source, {onProgress?})`, `files.saveToDisk(path)`, `files.openForView(path)`, optional `files.pickUploads()`. `UploadSource` is opaque (`name`, `size?`), and its comment already allows a native host its own kind (a local path). The contract has no cancel, and `saveToDisk` reports no progress |
| Browser host | `packages/workbench/src/host/browser-files.ts` | Upload hands the `Blob` to the SDK. `saveToDisk` with a save target downloads 8 MiB ranges through the SDK and awaits `target.write` per chunk. `openForView` downloads the whole file into a `Blob` and returns an object URL |
| Desktop host | `desktop/apps/pistudiodesktop/src/host/transfers.ts`, `desktop-host.ts` | The browser `files` with a save target backed by `save_begin` / `save_write` / `save_finish` / `save_discard`: Rust shows the dialog and owns the file, but every chunk crosses the socket into the page and then IPC back to Rust. Uploads and saves in flight are counted and reported with `transfers_set`. There is no `pickUploads` |
| Close while transferring | `desktop/apps/pistudiodesktop/src-tauri/src/transfers.rs` | With the page's count above zero, closing the window asks first. Switching daemons checks the same count |
| Explorer UI | `packages/workbench/src/features/files/FileExplorer.tsx`, `upload-sources.ts`, `SaveFileButton.tsx`, `hooks/use-file-transfer.ts` | An upload shows a status line with the batch's percentage and asks before overwriting a name in the listing. There is no cancel control, and a save shows no progress. After an upload the explorer listing is invalidated by the page |
| Viewers | `packages/workbench/src/hooks/use-file-download.ts`, `use-inline-image.ts`, `features/files/HtmlViewer.tsx` | Image, video, PDF, molecule and large-text viewers and inline chat images use `files.openForView` (whole file in a `Blob`). The HTML viewer's assets call the SDK's `download` directly, not the host |
| OS file drops | `desktop/apps/pistudiodesktop/src-tauri/tauri.conf.json` | `dragDropEnabled` is `false` (milestone 1, D6), so drops are HTML5 drops: the page gets `File`s with no path. Per Tauri's documentation, turning it on blocks HTML5 drops on Windows, and the workbench uses HTML5 drags for tree moves, pane drops and composer inserts |
| Rust socket | `desktop/crates/net/src/dial.rs`, `limits.rs`, `proxy/` | `dial(url, password, limit)` answers a WebSocket (TCP or TLS, bearer password, error classes). The proxy allows 4 connections at once and a 128 MiB message |
| Who knows the daemon | `desktop/apps/pistudiodesktop/src-tauri/src/transport.rs` | `transport_open` asks the owner thread for the current entry (kind, address, where the password is) and reads the password on the blocking pool. A relay entry has no Rust socket: its connection is the webview's until milestone 4 |
| Custom scheme | `desktop/apps/pistudiodesktop/src-tauri/src/preview_scheme.rs` | One URI scheme is already registered, for the HTML preview. It is the precedent for a URL served by Rust |
| Wire, download | `docs/desktop-client-handoff.md` § 2, `packages/server/src/files/file-transfer.ts` | By path, with `offset` / `length` / `ifUnchanged`, the response before the frames, `file_download_cancel_request`, stream ids per session. The daemon paces on its socket's queue (1 MiB / 256 KiB) |
| Wire, upload | same | `file_upload_request {path, transferId, ack}` answers a stream id (one byte, shared by all sessions of the daemon); `Begin`, `Chunk`s, `End` must come on the session that sent the request; `file_upload_complete` confirms the write. The daemon opens the target with `"w"` (the existing file is truncated at once), leaves a partial file after a failure, and cannot resume an upload |
| Wire, sizes | same | Chunks are 32 KiB. No upload size cap in the daemon |
| Quiet connection | `packages/protocol` (`hello.agentStreams`) | A session that sends `"none"` gets no `agent_stream` frame. Built in sprint 098 for this connection |
| Measured in milestone 2 | `swe/features/desktop-transport-bridge.md` | 1 GiB down and up through the proxy at 155–166 MiB/s; a 1 GiB upload grows the page by about 2 GiB on WebKitGTK; transfers and terminals share one socket (row B7 was reported, not gated) |

## Problem & outcome

(Drafted from the handoff; the engineer sent no correction in round 1.)

- **Who:** a desktop-app user moving large files to or from a daemon.
- **Today:** every byte goes through the page. A 1 GiB upload grows the page by about 2 GiB on
  WebKitGTK, a save crosses the socket and then IPC chunk by chunk, and a transfer shares the one
  socket with the terminal and the chat.
- **Done means:** a multi-gigabyte file moves both ways with flat memory use while a terminal
  stays responsive.
- **Measured by:** one 5 GiB upload and one 5 GiB save on Linux over loopback, against pass marks
  for memory, speed and the terminal's echo (D16).

## Goals

- An upload from a file chosen in a native picker, and a save to disk, run in Rust on a connection
  of their own; the bytes never enter the page (D1, D3).
- A transfer continues by itself after the connection drops, while the app runs (D5).
- Transfers do not share a socket with the terminal and the chat: they run on a second connection
  that exists only while there is something to transfer (D6).
- Several transfers run at once, so a small file does not wait behind a large one (D7).
- A save shows its progress, as an upload does, and both can be cancelled, in the desktop app and
  in the browser client (D8).
- The file the user chose to save into never holds half a download (D9).

## Non-goals

- Viewers served by Rust: `files.openForView` keeps `Blob` URLs (D1).
- A relay entry: its transfers keep today's path through the page until milestone 4 (D2).
- Native file drops with real paths: a dropped file keeps today's path through the page (D3).
- Any change to the daemon or the wire protocol: no upload resume, no larger chunk (D4).
- A transfer that survives quitting the app (D5).

## Happy path

For a local or direct entry (D2). A relay entry, and a file dropped on the window, behave as today.

**Upload**

1. The user presses Upload in the Files explorer. A native picker opens; the user chooses one or
   more files (D3).
2. For a name that already exists in the listing, the page asks before overwriting, as today.
3. The page hands each chosen file to `files.upload`. Rust queues them; up to three transfers run
   at once and the rest wait in order (D7).
4. If the bulk connection is not open, Rust opens it: the dial of milestone 2 and a `hello` with
   `agentStreams: "none"` (D6).
5. Rust reads the file from disk and sends it, paced. The page never holds its bytes.
6. The explorer's status line shows the percentage and a Cancel control (D8).
7. The daemon confirms the write (`file_upload_complete`). The upload settles, and the page
   refreshes the listing, as today.

**Save to disk**

1. The user chooses Download on a file. The native save dialog opens; the user chooses where.
2. Rust queues the download (the same limit of three), and opens the bulk connection if needed.
3. Rust requests the file by path and writes what arrives into `name.part` next to the chosen
   file (D9).
4. The status line shows the percentage and a Cancel control (D8).
5. When the last byte is written, Rust renames `name.part` to the chosen name, and the save
   settles.

**Afterwards.** With no transfer running or waiting for a short idle time, Rust closes the bulk
connection (D6).

**A dropped connection.** Rust opens the bulk connection again and continues: a download from the
byte it stopped at, into the same `name.part`; an upload from zero (D5).

## Decisions

| # | Theme | Question | Decision | Rationale | Round |
|---|-------|----------|----------|-----------|-------|
| D1 | scope | Which byte paths move to Rust | Upload and save-to-disk only. Viewers keep `Blob` URLs and become a follow-up | It matches the milestone's check and gets to milestone 4 sooner; a URL served by Rust needs range requests on three webviews, the riskiest part | 1 |
| D2 | scope | Relay entries | A relay entry keeps today's path through the page until milestone 4. The engine serves local and direct entries only | Rust has no relay socket yet, and the milestone order (2, 3, 4) is not changed | 1 |
| D3 | scope | How a local file reaches the engine | A native picker for the Upload button. A file dropped on the window keeps today's path through the page | Rust needs a real path. Tauri's own drop handling would give one, but per its documentation it blocks HTML5 drags on Windows, which the workbench uses | 1 |
| D4 | scope | Daemon protocol changes | None. The engine uses the wire as it is; a failed upload starts again from zero | Milestone 2 measured 155–166 MiB/s with 32 KiB chunks, so the chunk size does not limit the speed | 1 |
| D5 | scope | A connection that drops during a transfer | The engine reconnects and continues by itself while the app runs: a download resumes where it stopped (`offset`, `ifUnchanged`), an upload restarts from zero. Nothing survives quitting the app | The wire resumes downloads only (D4); a queue kept on disk is more state than the check needs | 1 |
| D6 | happy path | When the bulk connection exists | Opened by the first transfer and closed after a short idle time. It is a second session on the daemon, with `agentStreams: "none"` | No idle second session on the daemon, and nothing to keep alive across a sleep when nothing transfers | 2 |
| D7 | happy path | How many transfers run at once | Up to 3 at once on the one connection; the rest wait in order | A small file does not wait behind a 10 GiB one, and the number of streams stays bounded | 2 |
| D8 | happy path | What the user sees and can do | The explorer's status line shows a percentage for uploads and for saves, with a Cancel control. Progress for a save and cancel for both are added to the host contract, so the browser client gets them too. The engineer's note: a download has no indicator today, and it should get one like the upload's | Small, and enough for a transfer that takes minutes. A transfers list is deferred | 2 |
| D9 | data | Where a download is written while it runs | Into `name.part` next to the chosen file; renamed when complete, deleted on cancel or on a final failure | The chosen name never holds half a file, and a resume continues the same `.part` | 2 |
| D10 | integration | Switching daemon or closing the window while transfers run | As today: ask first; "yes" cancels the transfers | The window shows one daemon, and nothing runs that it cannot show | 2 |
| D11 | edge cases | Several transfers and one status line (D7 against D8) | One line per activity, stacked. A picked batch is one activity: its files go one after another, as today, with one percentage and one Cancel for the batch. Each save is its own line with its own Cancel. The limit of three (D7) counts running transfers across activities | Cancel needs a target, and the page's batch loop stays as it is | 3 |
| D12 | edge cases | How long the engine retries after a drop | Until the user cancels or the window leaves the entry; the line says it is waiting for the connection. An error a retry cannot fix fails at once: a refused password, a certificate error, a file that is gone, a full disk | A laptop that sleeps overnight continues in the morning | 3 |
| D13 | edge cases | A download resumes and the daemon answers `changed` | The save fails with "the file changed on the daemon" and the `.part` is deleted. No automatic restart | A file that keeps changing (a log) would restart forever | 3 |
| D14 | edge cases | A cancelled or failed upload leaves half a file on the daemon | As today: the partial file stays and the status line says the upload did not finish. The engine does not delete it and does not upload under a temporary name | The same behaviour in both clients, and no new mechanism (D4) | 3 |
| D15 | edge cases | Fourteen cases proposed without alternatives | Accepted as written; they are the rows marked D15 under Edge cases & failure modes | The engineer ticked "record the table as proposed" and sent no objection | 3 |
| D16 | acceptance | The check that closes the milestone | A 5 GiB file, one upload and one save, on Linux over loopback, with pass marks: Rust's memory grows by at most 64 MiB and the page's by at most 32 MiB; identical hashes; not slower than the same transfer through the page on the same build; a key typed in a terminal meanwhile echoes at most 5 ms later in the median and 50 ms at the 99th percentile than with no transfer | It crosses the 4 GiB boundary and is cheap to repeat | 4 |
| D17 | acceptance | Which machines must pass | As milestone 2: live on Linux, the automated suites on the macOS and Windows runners, and the manual macOS and Windows steps as open rows in `desktop/docs/platform-checks.md` | The same bar as the milestone before it | 4 |
| D18 | non-functional | A way back to the old path | A launch option that forces the page's path, like `--secret-store`. No setting in the UI | A merge to `main` releases the app automatically; the option is also how the check compares the two paths on one build | 4 |
| D19 | non-functional | What the app records | `ui.inspect` gains a transfers section (the bulk connection's state, running and waiting transfers with their bytes, the last error). The app's log records the start, end and failure of each transfer with size, duration, error code and both paths. Never a password | The log stays on the user's machine, and a path is what makes a report useful | 4 |
| D20 | non-functional | Five constraints proposed without alternatives | Accepted as written; they are the rows marked D20 under Non-functional constraints | The engineer ticked "record the table as proposed" and sent no objection | 4 |

## Data & state

- **A transfer** lives in Rust's memory only, for one run of the app: its kind (upload or save),
  the daemon path, the local path, the total and the bytes done, and its state (waiting, running,
  reconnecting, done, failed, cancelled). A download also keeps the daemon's `totalBytes` and
  `mtimeMs` from its first response, for `ifUnchanged` on a resume (D5).
- **On disk:** only `name.part` while a download runs (D9). No queue file, no history.
- **Owner:** Rust owns the transfers and the bulk connection. The page holds a promise per
  transfer, its progress callback and its cancel.
- **Host contract** (`packages/workbench/src/host/types.ts`): `saveToDisk` gains progress; `upload`
  and `saveToDisk` gain cancel; the desktop host adds `pickUploads`, whose sources carry a handle
  Rust issued. The page never holds or sends a local path (D3, D8, D20). Shapes are for the spec.
- **Lifetime:** every transfer of an entry ends when the window leaves that entry or closes (D10).

## Integration points

| Existing module / service / config | How the feature touches it | Direction | Risk / note |
|------------------------------------|----------------------------|-----------|-------------|
| `packages/workbench/src/host/types.ts` (`HostFiles`, `UploadOptions`) | Progress for `saveToDisk`, cancel for `upload` and `saveToDisk` | changes the contract | Every host and the test host follow |
| `packages/workbench/src/host/browser-files.ts` | Implements the new progress and cancel with the SDK's `onProgress` and `signal` | consumes | The browser client and a relay entry in the desktop app use this path |
| `packages/workbench/src/features/files` (`upload-sources.ts`, `SaveFileButton.tsx`, `FileExplorer.tsx`) | The status line shows saves too, and gets a Cancel control | writes | UI change in both clients; the owner checks the web client by eye before a merge |
| `desktop/apps/pistudiodesktop/src/host` (`transfers.ts`, `desktop-host.ts`) | `files.upload` (for a picked file), `files.saveToDisk` and `files.pickUploads` call Rust for a local or direct entry; otherwise the browser host's | calls | Replaces `save_begin` / `save_write` / `save_finish` / `save_discard` for those entries; a relay entry still needs them |
| `desktop/crates/net` (`dial`) | The bulk connection is a second dial | calls | Until now only the proxy used a dialed socket; the engine speaks the daemon's protocol on it (handshake, RPC, binary frames) in Rust for the first time |
| `desktop/apps/pistudiodesktop/src-tauri/src/transport.rs` (the owner thread, the secret store) | The engine needs the current entry's address and password, as `transport_open` does | reads | The password stays in Rust |
| `desktop/apps/pistudiodesktop/src-tauri/src/transfers.rs` (`transfers_set`, the close question) | Rust now knows its own transfers; the page's count still covers the transfers that run in the page | reads | The question on close and on a switch must count both |
| Daemon (`packages/server/src/files/file-transfer.ts`) | Used as it is (D4) | consumes | The bulk connection is one more session: one more row in `daemon_status` |
| `packages/protocol/fixtures/external-clients/` (file-transfer JSON and binary fixtures) | The Rust implementation is tested against them | reads | A fixture change is a published-contract change |
| `ui.inspect` | Gains a transfers section | writes | Beside `connection`, which milestone 2 added (D19) |
| The app's launch options and log (`desktop/apps/pistudiodesktop/src-tauri/src`) | One more option, which forces the page's path; log lines per transfer | reads / writes | The option is parsed where `--secret-store` is (D18, D19) |
| `desktop/docs/platform-checks.md` | A milestone 3 section with the manual macOS and Windows steps | writes | They stay open rows (D17) |

## Edge cases & failure modes

| Area | Condition | Decided behavior | Decision |
|------|-----------|------------------|----------|
| inputs | Any size, down to an empty file | Every picked upload and every save of a local or direct entry goes through the engine; there is no size threshold | D15 |
| inputs | A folder | The picker offers files only, as today | D15 |
| inputs | The local file cannot be read | The upload fails at once with the system's reason | D15 |
| inputs | The local file changes size during an upload | The upload fails with "the file changed during the upload". The partial file stays on the daemon (D14) | D15 |
| identity & access | The password is refused, or the certificate is not accepted, when the bulk connection opens or reopens | Every transfer that needs the connection fails at once; no retry | D12 |
| identity & access | The password | It stays in Rust, as for `transport_open`; the page never holds it | D6 |
| state | Two saves into the same local file | The second is refused while the first runs | D15 |
| state | A `name.part` already exists at the destination | It is replaced | D15 |
| state | Two things running at once | One line per activity, each with its own Cancel | D11 |
| state | The daemon file changed between two parts of a download | The save fails and the `.part` is deleted | D13 |
| state | An upload onto an existing file fails or is cancelled | The old content is gone (the daemon truncates at the start) and a partial file stays | D14 |
| timing | The connection drops | The engine reconnects and retries until cancelled: a download continues, an upload starts again | D5, D12 |
| timing | The machine wakes, or the network changes | The engine reconnects at once | D15 |
| timing | No byte moves for 30 s | Counted as a dropped connection | D15 |
| timing | Cancel while a transfer waits or reconnects | Immediate; the `.part` is deleted | D15 |
| timing | Only one of the two connections drops | They are independent: transfers go on while the chat reconnects, and the reverse | D15 |
| timing | The window switches daemon or closes during a transfer | The user is asked; "yes" cancels | D10 |
| scale | More than 3 transfers | The rest wait in order; the queue has no limit | D7, D15 |
| scale | A picked batch of many files | One after another, inside one activity | D11 |
| dependencies | A daemon that lacks download ranges, the upload confirmation or the quiet connection (`fileDownloadRanges`, `fileTransferAck`, `agentStreamsMode`) | The page's path is used, as for a relay entry | D15 |
| dependencies | A relay entry | The page's path, until milestone 4 | D2 |
| dependencies | The daemon has no free upload stream (`no_free_stream`) | The upload fails with a message | D15 |
| dependencies | The daemon reports a failed write (`file_upload_complete` with `ok: false`) | The upload fails with the daemon's reason | D15 |
| dependencies | The local disk is full, or a write fails, during a save | The save fails with the system's reason; the `.part` is deleted | D15 |
| data lifecycle | The app crashes or is killed during a save | The `name.part` stays on disk; nothing cleans it up at the next launch | D15 |
| data lifecycle | Quitting the app | Running transfers are cancelled after the question (D10); nothing is kept for the next run | D5 |
| observability & ops | What is recorded | `ui.inspect`'s transfers section and log lines per transfer, with paths and without a password | D19 |
| observability & ops | The engine misbehaves in a released build | The launch option forces the page's path | D18 |

## Non-functional constraints

| Concern | Constraint / decision |
|---------|-----------------------|
| Performance / volume | The pass marks of D16, on a 5 GiB file. At most 3 transfers at once (D7); what Rust holds per transfer is bounded and does not grow with the file |
| Security & authorization | The page names a local file only through a handle Rust issued from its own picker or save dialog; it cannot hand Rust a local path, so a compromised page cannot read or overwrite arbitrary files (D20). Rust connects only to the current entry's address, with the password from the secret store, as `transport_open` does; the page receives neither (D20). What the daemon sends is treated as hostile, as in the proxy: sizes are checked before use, a frame that breaks the protocol fails that transfer, nothing panics (D20) |
| Privacy | Local and daemon paths are written to the app's own log on the user's machine (D19). No file content and no password is logged |
| Backward compatibility | The wire is unchanged (D4). The host contract only gains optional members, so the browser client and other hosts keep working. The `save_*` commands stay, for relay entries (D20). A daemon without the needed flags gets the page's path (D15) |
| Rollout / feature flag | No flag in the UI. The engine is the path for local and direct entries once merged; the launch option of D18 forces the page's path |
| Observability | `ui.inspect`'s transfers section and the log lines of D19 |
| Rollback | The launch option of D18. Nothing is written that an older app version would have to read: no queue file, only a `name.part` while a download runs |
| Tests | The Rust protocol code is tested against the published file-transfer fixtures (JSON and binary) and against a real dev daemon (D20). Machines: D17 |

## Deferred

- Viewers through a URL served by Rust (custom scheme, range requests): a follow-up after this
  milestone (D1).
- Transfers of a relay entry in Rust: milestone 4 (D2).
- Native file drops with real paths: not scheduled (D3). Until then a large dropped file still
  grows the page, as today.
- Upload resume and a larger chunk size, both in the daemon: not scheduled (D4).
- Unfinished downloads that survive quitting the app: not scheduled (D5).
- A transfers list (one row per transfer with speed and retry): not scheduled (D8).
- An upload that cannot leave half a file under the real name (a temporary name on the daemon,
  then a move): not scheduled (D14).
- Cleaning up a `name.part` left by a crash: not scheduled (D15).
- Uploading a folder: not scheduled (D15).

## Open questions — TODO(verify)

- [ ] The idle time after which the bulk connection closes (D6): a value to choose — owner: the
  agent, at scope.
- [ ] The 30 s without a byte that counts as a dropped connection (D15) is proposed, not
  measured: confirm or change the value — owner: the agent, at scope.

## Acceptance criteria (draft)

For a local or direct entry in the desktop app, unless a row says otherwise.

- [ ] Given a 5 GiB file chosen in the native picker, when it is uploaded, then the daemon's copy
  has the same hash, Rust's memory grew by at most 64 MiB and the page's by at most 32 MiB, and
  the upload was not slower than the same upload through the page on the same build (D16).
- [ ] Given a 5 GiB file on the daemon, when it is saved to disk, then the same four marks hold
  (D16).
- [ ] Given either transfer running, when keys are typed in a terminal, then the echo is at most
  5 ms later in the median and 50 ms at the 99th percentile than with no transfer (D16).
- [ ] Given a transfer running, then `daemon_status` lists a second session of the app with
  `agentStreams: "none"`; given none running or waiting for the idle time, it is gone (D6).
- [ ] Given four transfers started together, then three run and the fourth starts when one of
  them ends (D7).
- [ ] Given a picked batch and two saves, then the explorer shows three lines, each with a
  percentage and its own Cancel; the batch's files go one after another (D8, D11).
- [ ] Given the browser client, then a save shows a percentage and Cancel, and an upload has
  Cancel (D8).
- [ ] Given a save in progress, then the chosen name does not hold partial data and `name.part`
  does; when it completes, `name.part` is gone and the chosen name holds the file (D9).
- [ ] Given a save cancelled, then `name.part` is gone. Given an upload cancelled, then the
  partial file stays on the daemon and the line says the upload did not finish (D9, D14).
- [ ] Given the bulk connection cut during a save, then the save continues from the byte it
  stopped at and the hash matches. Given it cut during an upload, then the upload starts again
  and the hash matches (D5).
- [ ] Given the daemon stopped during a transfer, then the line says it is waiting for the
  connection, and the transfer continues once the daemon is back, however long that takes (D12).
- [ ] Given the daemon file modified while a save waits to resume, then the save fails with "the
  file changed on the daemon" and `name.part` is gone (D13).
- [ ] Given a password the daemon refuses when the bulk connection opens, then the transfer fails
  at once and is not retried (D12).
- [ ] Given a transfer running, when the user switches daemon or closes the window, then the app
  asks first, counting the transfers in Rust and those in the page; "yes" cancels them (D10).
- [ ] Given a relay entry, a file dropped on the window, a daemon without the needed flags, or
  the launch option, then the transfer takes the page's path and works as before (D2, D3, D15,
  D18).
- [ ] Given a request from the page that names a local file by anything but a handle Rust issued,
  then it is refused (D20).
- [ ] Given a transfer that ended or failed, then `ui.inspect` and the log show it, with both
  paths and no password (D19).
- [ ] The Rust protocol code passes against the published file-transfer fixtures, JSON and binary
  (D20).
- [ ] Live on Linux; the automated suites pass on the macOS and Windows runners; the manual steps
  are rows in `desktop/docs/platform-checks.md` (D17).

## Round log

| Round | Theme | Summary |
|-------|-------|---------|
| 1 | problem & outcome, scope boundary | Merged: the handoff already states the problem, and the engineer sent no correction. D1–D5, every recommendation taken: upload and save only, local and direct entries only, native picker (drops unchanged), no protocol change, automatic recovery while the app runs |
| 2 | happy path, data & state, integration points | Merged: the three depend on each other. D6–D10, every recommendation taken: a connection on demand, three transfers at once, a percentage and Cancel for uploads and saves in both clients, `name.part`, ask before a switch or a close. The engineer asked that a download gets an indicator like the upload's (in D8) |
| 3 | edge cases & failure modes | D11–D15, every recommendation taken: one status line per activity, retry until cancelled, a changed file fails the save, a partial upload stays as today, and the table of fourteen cases accepted as written. A conflict between D7 and D8 (three transfers, one status line) was raised and settled by D11 |
| 4 | non-functional constraints, acceptance | Merged. D16–D20, every recommendation taken: a 5 GiB check with pass marks, the machines of milestone 2, a launch option back to the page's path, a transfers section in `ui.inspect` and log lines with paths, and the table of five constraints accepted as written. The acceptance criteria were drafted from D1–D20 and wait for the engineer's confirmation with the readout |

## Handoff to scope

(Proposed with the readout; final when the engineer confirms and the status becomes `grilled`.
This repository keeps specs in `swe/features/` and `swe/architecture/`, not in `swe/specs/`.)

| Spec file to produce or update | Fed by brief sections |
|--------------------------------|-----------------------|
| `swe/features/desktop-transfer-engine.md` (new) | Goals, Non-goals, Happy path, Decisions, Data & state, Edge cases, Non-functional constraints, Acceptance criteria |
| `swe/architecture/workbench-host-adapter.md` (update: `HostFiles`) | Data & state (the host contract), Integration points, D8, D11, D20 |
| `swe/features/file-explorer-transfer.md` (update: the status lines and Cancel in both clients) | Happy path, D8, D11, D14 |
| `docs/desktop-client-handoff.md` (update: milestone 3's state) | Round log, Deferred |
