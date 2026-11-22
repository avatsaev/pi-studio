# Architecture

A Tauri window whose webview runs the workbench (`@av-pi-studio/workbench`, the UI shared with the
browser client), and a Rust workspace in enforced layers with all platform code at the edge.

Two halves, joined by the page's commands (§ The webview boundary):

- **The window.** `apps/pistudiodesktop/src` mounts the workbench and gives it a host
  (`WorkbenchHost`, `packages/workbench/README.md`). The desktop host is the workbench's browser
  host with the members Rust backs replaced: storage, dialogs, links, save-to-disk, the HTML
  preview and the daemon registry. For every current entry (local, direct, relay or SSH) the
  host's `createTransport` returns a proxied connection through Rust (`transport_open`): the page's
  only socket is the one to the loopback proxy. The browser host's upload and view URLs stay; the
  file transfers of every entry go through the engine. Outside Tauri (the snapshot tool, a browser on the dev
  server) the page uses the plain browser host.
- **The Rust workspace.** A headless engine in which every action is a command, holding the
  daemon registry, the settings and the workbench's stored keys, and a shell that turns its state
  into one value, generates the menu bar, answers the page's commands and supervises the local
  daemon. Everything below "Layers" describes this half.

## Layers

A crate may depend only on crates in lower layers. Nothing below the app binary may use a UI
toolkit, a webview or a windowing crate (tauri, wry, tao, muda, rfd). `cargo xtask layers` checks
both on every run of the gate; the table it checks is `TABLE` in `xtask/src/layers.rs`, and a crate
missing from it fails the gate.

| Layer | Crates | What belongs here |
|---|---|---|
| L0 | none yet | Types with no domain model (geometry, units, colour, storage containers), and standalone crates that parse or encode a foreign format and depend on no workspace crate |
| L1 | `model` | The settings, the daemon registry (entry kinds `local`, `direct`, `relay`, `ssh`; file version 3) and one entry's stored state, as plain serde data with the limits that keep them valid; `RemoteState`; the address rule (a stored address to the `ws`/`wss` URL the workbench opens), checked against vectors shared with the workbench; the pairing-link parser (`pairing.rs`: `parse(link)` gives the daemon's 32-byte key and a relay or a direct target, `invalid_link` otherwise), checked against `packages/client/src/pairing-link.vectors.json`, which the SDK's test reads too |
| L2 | none yet | Domain algorithms written as pure functions over L0 and L1 data |
| L3 | `store` | JSON files: read with a fallback when corrupt, written atomically. Knows no document type; empty on wasm32 |
| L4 | none yet | Mapping the model to and from foreign formats; a plug-in host |
| L5 | `engine` | `Session`, the command registry, the daemon registry, the settings and the stored workbench keys: the façade every frontend talks to |
| L6 | `shell` | UI state, the menu bar generated from the registry (the Daemons menu included), shortcuts, the control protocol, the page's commands, the local-daemon supervisor and the remote one (`remote_supervisor.rs`, native only: the probe and Start of an SSH entry's daemon over `Services::remote_run`). No UI toolkit: it produces the view as data |
| L7 | `net` | Sockets: the dial and the loopback proxy. `dial` opens a WebSocket to a daemon within a time limit (TCP with `TCP_NODELAY` and keepalive; TLS by `rustls` with the `ring` provider, the certificate judged by the operating system's verifier through `rustls-platform-verifier`, no option to accept an untrusted one; the upgrade with the `pi-studio.bearer.<password>` subprotocol; a message limit, which the caller passes, set on the socket: the proxy passes 128 MiB, the transfer engine 16 MiB) and fails with a code (`check_address` is the address check alone, before any network use; `invalid_address`, `unreachable`, `tls`, `unauthorized`, `host_not_allowed`, `handshake`, `timeout`) and a message that never holds the password. `dial_over(stream, url, password, limit, max message)` runs the same request (the `Host` header from the URL, the bearer subprotocol), limits and error mapping on any stream the caller opened (an SSH channel). Both answer a `DaemonSocket` (`socket.rs`): a boxed stream and sink of WebSocket messages with `max_message_bytes()`. A WebSocket over any stream is one (`DaemonSocket::new`); `DaemonSocket::from_wire(wire, max)` wraps anything else that speaks messages (the relay's sealed channel), so the proxy and the transfer engine do not know what carries them. `proxy` takes an open `DaemonSocket` and the page's origin and answers a single-use local URL `ws://127.0.0.1:<port>/<token>`: a listener of its own on a port the system chooses, closed when the page's upgrade is accepted or after 10 s; a token of 256 random bits compared in constant time; the `Origin` and `Host` checked; a bare 403 for anything else, which does not use the token up; at most 16 upgrades read at once, 2 s each. Then one task per direction passes messages unchanged and in order, and reads the next only when the write of the previous has completed, so Rust holds at most a 256 KiB or 64-message write batch and one message per direction (a peak counter records it); each leg answers its own pings and none is passed on; a close frame passes with its code and reason (2 s for the answer); a leg that ends without one drops the page's leg (the page sees 1006) or closes the daemon's with 1001; a message above 128 MiB closes both legs with 1009. A `Proxies` set holds at most four connections (`reserve` before the dial, so a fifth is `limit` without a daemon being dialled; `Reservation::open` after it), closes them all (1001 to each daemon, page legs dropped) and gives the snapshot `ui.inspect` shows: state, frames and bytes each way, the peak held, and the last abnormal end (`page_refused`, `page_timeout`, `upstream_lost`, `too_large`) with its time. The crate has no log: the app gives the proxy a function for its lines, which never carry the token, the local address or anything a peer sent. Tested against local servers, with hostile input, without Tauri. Above `shell` on purpose, so `engine` and `shell` cannot depend on it, and the layer check lets no UI crate (tauri, wry, tao) into it; only `transfer`, `relay`, `ssh` and an app binary may use it. Empty on wasm32, where it has no dependency |
| L8 | `transfer` | The transfer engine, native only: uploads and saves over a connection of its own to the daemon, with no window and no Tauri. Its `Connector` gives it a `net::DaemonSocket` (a WebSocket over TCP or TLS, an SSH channel or a relay's sealed channel: the crate does not know which; there is no `Transport` trait), and it may use no UI crate. The crate holds its limits (`limits.rs`: the idle close, the ping and drop times, the reconnect backoff, the answer time, the close wait, the 16 MiB message limit, the download hold, the three transfers and the 32 KiB chunk, with a `Limits` a test can shorten), its one error type (`Dial`, `UnsupportedDaemon`, `Protocol`, `Timeout`, `Rpc`, `Closed` with the reason the connection ended, `Internal`), `wire`, the daemon's frames with no socket, clock or state, and `connection`, the bulk connection. `wire::outbound` builds the text the engine sends (`hello` with `agentStreams: "none"` and no `capabilities`, the upload, download and download-cancel requests, `ping`, `pong`). `wire::inbound` reads a text frame no further than the engine needs: `server_info`'s three feature flags, a `session` reply with a `requestId` (all fields kept, with typed readers for the upload, download and cancel answers), `rpc_error`, `file_upload_complete`, `ping`, `pong`, and any other frame by its `type`. `wire::binary` builds an upload's `Begin` (`transferId` only), `Chunk`, `End` and `Error`, reads a download's, `Begin` with its whole metadata, and tells whether an opcode is one of the four file-transfer opcodes. Every number from the daemon is a whole number from 0 to 2^53 − 1 kept as a `u64`; a text or binary frame over the message limit, a short frame, an unknown opcode, a bad `Begin` and a number that does not fit are `Error::Protocol`, never a panic, and the error never repeats the daemon's words. The tests read the published fixtures from `packages/protocol/fixtures/external-clients/` and run a seeded loop of random, truncated and mutated input. `Connection::open` takes the `DaemonSocket` the connector gave (a test builds one over a pipe), sends `hello`, waits for `server_info` and requires the three feature flags, `fileDownloadRanges`, `fileTransferAck` and `agentStreamsMode` (`unsupported_daemon` otherwise), then runs a reader task and a writer task. `request` sends a `session` frame with a fresh `requestId` and returns the answer with that id: an `rpc_error` with it is that request's `Error::Rpc`, and no answer within 30 seconds is `Error::Timeout` for that request alone, with the connection still open. `send_text` and `send_binary` return when the frame is on the socket, so a sender has one frame in flight. `expect_upload` registers a `transferId` before the request, and the confirmation `file_upload_complete` with that id goes to the one who waits on it. `download` takes a stream id from 0 to 255 and returns the frames on that stream; the reader takes a frame off the socket only while the consumer has released enough of what it was given (the download hold, 1 MiB and one frame), so the connection reads no faster than the consumer writes and memory does not grow with the file; the other transfers wait with a slow one. After 10 seconds with no frame of any kind from the daemon the reader sends a `ping`, and after 30 it ends the connection; a daemon that keeps sending chunks is never pinged, and time spent waiting for a consumer is not silence. A `ping` from the daemon is answered with a `pong`. A message above 16 MiB, text that is not UTF-8 and a frame `wire` cannot read end the connection with `Error::Protocol` and a close frame 1002; a text frame nobody awaits and a binary frame that is not `0x10`–`0x13` or is on no running download are ignored. However a connection ends (the daemon's close code, a reset, silence, a close from this side, the protocol error), every waiter is told once with the reason, a download first gets what was queued for it, and every later call fails with the same reason. Closing when idle, reconnecting and the queue belong to the engine, not the connection. The `download` module saves one file over an open connection into a `Sink` (`written`, `write`, `finish`, `discard`; the app implements it over a save's temporary file, a test over memory). `save` takes a stream id from the connection's pool before it sends `file_download_request`, with `offset` (the sink's `written`) and `ifUnchanged { size, mtimeMs }` only on a resume and never a `length`, so the daemon sends to the end of the file. It checks the answer against the request (the stream, the offset, a range that ends at the end of the file, the guarded file) and `Begin` against the answer, writes each `Chunk` before it takes the next frame, so that at most the 1 MiB hold is waiting for the sink, and is done when `End` came and exactly the announced bytes were written, after which the sink is finished. More bytes than announced, a `Chunk` before `Begin` and an early `End` are `protocol`. The outcomes are `Saved { version, bytes }` or a `SaveError`: `changed`, `daemon_refused` with the daemon's reason, `disk` with the system's reason, `cancelled`, `protocol` and `internal` discard the sink; `ConnectionLost`, a lost connection or a request nobody answered, leaves the sink open and returns the file's `totalBytes` and `mtimeMs`, so that a later save can resume into it. The caller cancels with a future. Whenever a save ends before the daemon's last frame it sends `file_download_cancel_request` and keeps the stream id reserved until the daemon's last frame (an `Error` may be the first and only one), a refusal, or the connection's end, whichever order the daemon answers the cancel and the request in; after the answer time a task of its own keeps the reservation. One upload runs over the connection the same way: the request with `ack`, `Begin`, `Chunk`s of at most 32 KiB each awaited before the next is read (it holds one chunk whatever the file), `End`, then the wait for `file_upload_complete`, which must say `ok` with `bytesWritten` equal to the bytes sent; a stop after the daemon's answer sends `Error` (`client_aborted` or `client_error`). The engine drives both. `Engine<C: Connector>` takes uploads and saves (`upload(id, path, source)`, `save(id, path, sink)`), each resolving when the transfer has settled with the bytes or a `Failure { code, message }`; `id` is 1 to 64 characters of `A-Za-z0-9-` (`invalid_request`), one in use is `duplicate_id`. At most three transfers are active and the rest wait first in first out, with no limit. The caller's `Connector::connect` gives an open `DaemonSocket` to the current daemon, or a `ConnectError` with a code and whether a retry can help, so that the crate knows nothing of the registry, the secret store, the relay or SSH. The connection is dialled when the first transfer becomes active (the active ones are `waiting` until it is open) and closed with 1000 thirty seconds after nothing is active or queued; a transfer that starts before that keeps it. The caller's callback gets `{ id, state: queued | running | waiting, done, total }` at every change of state and at most once per 100 ms per transfer while bytes move, and none at settlement. `cancel(id)` settles a queued or waiting transfer at once and a running one after it has told the daemon; a save that did not complete is discarded before its call resolves; `cancel_all_and_close(Close)` settles them all and closes the connection. `snapshot()` is what `ui.inspect` shows as `transfers`, less `mode` and `entryId`: the connection's state and how often it opened, the active transfers (id, kind, state, bytes done and total, restarts), how many are queued, the totals of done, failed and cancelled, `peak_held` (the most bytes held at once: an upload's read buffer from the moment it runs and the frames of a download that the daemon sent and the sink has not written, counted by a `Held` gauge the connection shares), and the last error with its time on tokio's clock; it holds no path. A connection that cannot open or that drops makes the active transfers `waiting`: the engine dials again at once after a drop and then after 1 s, 2 s, 4 s … 30 s with no limit on the attempts (`Engine::wake` ends a wait at once; with nothing active or queued it stops), unless the error is final (`retry: false` from the connector, or one of `FINAL_CODES`: `unauthorized`, `host_not_allowed`, `tls`, `invalid_address`, `secret_missing`, `secret_unavailable`, `no_current`, `unsupported`, `unsupported_daemon`, `protocol`, the relay's `wrong_key`, `daemon_outdated`, `protocol_error`, `invalid_link`, and an SSH entry's `auth_failed`, `host_key_unknown`, `host_key_changed`, `passphrase_needed`, `key_unreadable`, `forwarding_refused`, `ssh_config`), which fails every active and queued transfer with its code; `handshake` and everything else is retried. After a reopen a save resumes from its sink's bytes with the guard of its first answer (a changed file fails it) and an upload starts again from byte 0 with a new `transferId` after rewinding its source; each counts a restart. All the queue's state is under one lock (`engine/queue.rs`), and a panic in a transfer settles it as `internal`. The engine's tests run on the stand-in with a frozen clock moved by hand (the idle close at 30 s, a transfer started at 29 s, the events' rate, a save in flight), and the stand-in records the close codes it reads. A stand-in daemon (`testing`, compiled in this crate's tests and with the `testing` feature only, which no release build turns on) runs in the test's process on `127.0.0.1` for the engine's tests. It answers the upgrade (401 without a required password), `hello` (`status` with configurable feature flags; 1008 for a first frame that is not a `hello`) and `ping`; keeps uploads in memory and stores a file only when `End` arrived; serves downloads from memory in the real daemon's order with `offset`, `length`, `ifUnchanged` and cancel; and does what a test scripts: close or reset after a count of bytes or frames, stop reading (and read again on `resume_reading()`), stop answering, `ok: false` with a chosen error, `rpc_error`, no answer, a failed upload, a wrong `bytesWritten`, and a download's frames out of order, oversized, too long, cut short or opening with an `Error`. A test can also give it a file of zeros that it makes as it sends and holds none (`put_counted_file`), have it count and acknowledge uploads without keeping a byte (`Config::store_uploads: false`), and ask how many stream ids are reserved on its live connections (`streams_in_use()`; a connection that ends frees its own). Its tests pin the frames it sends to the fixtures. The connection's tests run over an in-memory pipe to a scripted daemon on a paused clock, which moves time exactly and waits for nothing real, and against the stand-in over a real socket; the cases that need 10 or 30 seconds freeze the clock and move it by hand. The save's tests do the same: the sizes, a resume, a slow sink and every outcome against the stand-in, and the cancel racing the answer in both orders, a stalled daemon, a lying daemon and the hold on a scripted daemon. The engine's hardening tests (`engine/tests/`) run the engine against the stand-in with short real time limits: a table that drops and cancels an upload and a save at each of six stages (before the request, before its answer, before `Begin`, in the middle, after `End` and before the confirmation, while waiting to reconnect) and checks that nothing half-written is kept, no stream id stays reserved and the sink is finished or discarded once; every stand-in fault and a raw hostile WebSocket server, ending the connection as `protocol` or the transfer with its code, with nothing held beyond the limits and no panic in the library (a test-only panic hook counts them); a seeded soak of three transfers at once with random faults and cancels, in which every transfer settles and what completed is byte-exact; a search of every failure, event and snapshot for a planted password, local path, handle and daemon path; and 5 GiB through a source and a sink that hold nothing, with a resume offset past 4 GiB. `tokio`, `tokio-tungstenite` and `futures-util` are normal native dependencies of the crate. Empty on wasm32 |
| L8 | `relay` | The relay client, protocol 2, native only (`pistudiodesktop-relay`; it depends on `net` only, and only an app binary may use it). `connect(url, daemon_key, max_message_bytes, limit)` dials the relay with `net::dial` (no password, no subprotocol), sends `relay_client_connect` with the session id (hex of the first 16 bytes of SHA-512 of the daemon's key), waits for `relay_paired` (`relay_registered` is ignored), swaps keys with the daemon (`hello`, `ready`; `crypto_box`, a key pair for this connection only) and answers `Connected`, whose `into_socket()` is a `DaemonSocket` that seals each text or binary message as one binary frame (`MAX_SEALED_BYTES` 100 MiB, so `max_message_bytes()` is the caller's limit cut to fit). The whole connect is capped at `CONNECT_LIMIT` (15 s). A frame that does not open closes with 4200 and delivers nothing. A failure is a `RelayError` with one of the SDK's eight `RelayReason`s (`relay_unreachable`, `daemon_offline`, `daemon_unresponsive`, `too_many_clients`, `daemon_outdated`, `wrong_key`, `protocol_error`, `timeout`; a dial failure other than a timeout is `relay_unreachable`), whose texts a test compares with the SDK's. Pure parts (`session_id`, `Channel`) are tested against the fixtures of `packages/protocol/fixtures/external-clients/relay/`; the `testing` feature (never in a release build) is a loopback relay stand-in with a daemon half. It takes plain parameters, not a link: the pairing-link parser is in `model`. Empty on wasm32 |
| L8 | `ssh` | The SSH client, native only (`pistudiodesktop-ssh`, on `russh` with `ring` and `ssh2-config`; it depends on `net` only, and only an app binary may use it). Modules: `config` (`resolve` an entry against `~/.ssh/config` into a `Target`: host name, port, user, identity files, `IdentitiesOnly`, agent, up to 4 hops; the entry's own fields win; `ProxyCommand` and a malformed file are errors; `hosts` lists the plain `Host` names), `known_hosts` (`check` against `~/.ssh/known_hosts` and the app's own file, plain, hashed and `[host]:port` entries; `trust` appends to the app's file only, mode 0600; `describe` gives the key type and SHA-256 fingerprint), `session` (`connect` through the hops, each over a `direct-tcpip` channel of the previous one; 15 s per step and 45 s in all; keepalive every 15 s, dead after 3 unanswered; a receive window of 8 MiB per channel (`CHANNEL_WINDOW`; russh's 2 MiB ran a save at 25 MiB/s over a 40 ms round trip, 8 MiB at about 60; the packet size stays at russh's 32 KiB); `open_daemon(port, password, max)` is a `direct-tcpip` channel to the host's `127.0.0.1` with `net::dial_over` on it, giving a `DaemonSocket`), `login` (agent identities unless `IdentitiesOnly`, key files, then the stored password on the final host only; at most 6 attempts per host), `agent` (the agent socket; on Windows the OpenSSH pipe, then Pageant, never compiled on Linux), `command` (`Session::run(command, limit)`: `"$SHELL" -lic` between two random markers, 64 KiB of stdout kept, stderr dropped, nothing logged), `error` (the codes: `unreachable`, `timeout`, `handshake`, `host_key_unknown`, `host_key_changed`, `auth_failed`, `passphrase_needed`, `key_unreadable`, `forwarding_refused`, `daemon_not_running`, `ssh_lost`, `known_hosts`; a message holds no host, path or secret) and `testing` (feature, never in a release build: an in-process SSH server). `Cargo.lock` holds no `aws-lc` package: `cargo xtask layers` fails when it does. Empty on wasm32 |
| testkit | `testkit` | Test helpers; other crates use it as a dev-dependency only |
| apps | `pistudiodesktop` (`apps/pistudiodesktop/src-tauri`), `pistudiodesktop-cli` | Binaries: argument parsing, the Tauri window, file dialogs, sockets, OS integration |
| tool | `ipc-bench` (`apps/ipc-bench`) | The IPC benchmark, the gate of the transport bridge: a Tauri window with a static page (no npm package), a loopback WebSocket server and the candidates: the bridges (a client socket in Rust, a `Channel` inward and commands outward, with their own frame codec, inbound window and order buffer, which moved here from the `net` crate because the shipped bridge has none of them) and a loopback WebSocket proxy (Rust holds the socket, the page's own `WebSocket` reaches it over `127.0.0.1` with a single-use token and an origin check: the measured sketch of `net`'s `proxy`). Exempt from the layer rules, depends on no workspace crate but `net` (for its message limit), is never bundled or released, and adds no command or permission to the shipped app. How to run it: `development.md` § The IPC benchmark |
| frontend | `apps/pistudiodesktop/src` | React + TypeScript. Mounts the workbench and gives it a host. Not a crate; the UI itself is `packages/workbench` |

The layer numbers have gaps on purpose: a crate added later slots in without renumbering.

Where new code goes, stopping at the first yes:

1. Plain data the user's work consists of: **L1**.
2. A pure function over that data: **L2**, in a crate named for its domain.
3. Bytes in and out of the app's own format, or a store: **L3**.
4. Someone else's format or protocol: a **standalone L0** crate for the format, plus an **L4**
   crate that maps it to the model.
5. Something a user does: a **command in L5** that calls the code above.
6. State the UI shows that is not the model, a menu, a shortcut: **L6**, as data.
7. Something drawn or clicked: **the workbench** (`packages/workbench`), where the browser client
   gets it too.
8. Something only the platform can do (a dialog, a socket, a tray icon, a second window): **the
   app binary**, behind a service hook.

## The five seams

1. **`Session::execute(id, params) -> Result<Value>`** (`crates/engine/src/session.rs`) is the only
   way anything happens. It looks the id up, checks the params are a JSON object, checks the
   command's `enabled` predicate, and runs the command inside `catch_unwind`.
2. **The command registry** (`crates/engine/src/commands.rs`): one `CommandSpec` per command (id,
   label, menu, shortcut, params doc, `enabled`, `run`), collected from `<area>_cmds.rs` modules.
   Menus, shortcuts, `pistudiodesktop-cli commands` and the control channel's `engine.commands` are generated
   from it.
3. **Storage.** `Session::with_config_dir(dir)` loads three kinds of file from one configuration
   directory, and `Session::new()` keeps everything in memory and writes nothing: `settings.json`
   (the settings and the global workbench keys), `daemons.json` (the registry, mode 0600) and
   `daemon-state/<entry id>.json` (the current entry's workbench keys; `local` for this machine).
   A settings change is written before `settings.set` answers. The workbench's keys are opaque
   strings written often, so they are a plain API on `Session` (`storage_set`,
   `storage_snapshot`, `storage_flush`), not commands. A file that cannot be read is renamed aside
   and replaced by defaults, and the session returns a notice once. Logs name files, never their
   content. The engine reads and writes these files through the native-only `store` crate, not
   through service hooks.
4. **`Services`** (`crates/shell/src/services.rs`): optional function hooks the app binary fills
   in — `confirm`, `alert`, `open_url`, `pick_save_path` and `pick_files` (the open dialog, several files), built from the dialog and opener
   plug-ins in `src-tauri/src/services.rs`, and for the CLI `run` (a process with a time limit),
   `is_executable`, `env`, `home_dir` and `list_dir`, built from `shell::process`. The shell and
   the engine never call the OS themselves;
   the shell checks first (`links::check`: http, https and mailto only, at most 8,192 characters;
   `dialogs::cap_text`: 8,192 characters). Hooks may block, so the page's commands run them on the
   blocking pool, never on the owner or main thread. Where a hook is missing, the feature that
   needs it is disabled.
5. **The view and the control protocol** (`crates/shell/src/state.rs`, `control.rs`): all UI state
   is one serde struct, and `control::view` is the single value `ui.inspect` returns: UI state,
   the settings, the daemon list (views only, no secret), `connection: { secretStore, transports, lastError, resumeSignals }` and the menu model. Four JSON methods
   expose the running app over the control socket (`docs/control-protocol.md`); the webview does
   not use them.

## The webview boundary

The webview loads the built frontend from the binary (`tauri://localhost`) under the
Content-Security-Policy in `tauri.conf.json`, with no plug-in permissions
(`capabilities/default.json`). Every source except `style-src`'s, which the template already had,
was added only after `npm run snapshot` reported the page blocked without it:

| Directive | Sources beyond `'self'` | Needed by |
|---|---|---|
| `script-src` | `'wasm-unsafe-eval'` | Syntax highlighting (shiki's WebAssembly regex engine) |
| `worker-src` | `blob:` | The reconnect timers' worker; the pdf.js worker is a file of the app |
| `style-src` | `'unsafe-inline'` | Inline `style` attributes, and style elements made by script (the editor, the terminal, diagrams, math) |
| `img-src` | `data:`, `blob:` | Icons, and files opened from the daemon (the host hands viewers `blob:` URLs) |
| `media-src` | `blob:` | Video files opened from the daemon |
| `font-src` | `data:` | Fonts inlined by stylesheets |
| `connect-src` | `ws://127.0.0.1:*`, `blob:`, `ipc:`, `http://ipc.localhost` | The page's one WebSocket: its leg to the proxy, `ws://127.0.0.1:<port>/<token>` (the port is chosen per connection, so no narrower source can name it). The daemon of every entry (local, direct, relay or SSH) is dialled by Rust and needs no source, so no socket of the page leaves the machine; reading opened files back (`fetch` of a `blob:` URL); Tauri's own channel |
| `frame-src` | `pi-preview:` | The HTML file preview, served from the app's own preview origin |

The HTML file preview is served from an origin of its own, `pi-preview://localhost/<id>`, not a
`srcdoc` frame under this policy. `preview_mount` keeps the document in memory (at most 32
documents and 32 MiB; a 128-bit random id) and the scheme handler answers a `GET` of a mounted
id with `Content-Security-Policy: sandbox allow-scripts`, `no-store` and `nosniff`; anything else
is an empty 404 that is sandboxed too. `boot` clears the store, so a URL from before a reload is
dead. The frame is sandboxed without `allow-same-origin`: its scripts run, but it has no parent
access, no storage, no popups and no `__TAURI_INTERNALS__`. It has no capability; Tauri's
channel refuses its calls because it lacks the per-launch invoke key (a test pins this). The
navigation rule admits exactly `pi-preview://localhost`, because WebKitGTK runs it for subframes.

| Platform | Preview | Measured |
|---|---|---|
| Linux (WebKitGTK) | `origin`: scripts run, isolated | yes, 2026-11-20 (spike and sprint-105/task-005) |
| macOS (WKWebView) | `inert`: markup drawn, scripts blocked, a notice says why | no |
| Windows (WebView2) | `inert` | no; would also need `http://pi-preview.localhost` |

The page has exactly these Tauri commands (`apps/pistudiodesktop/src-tauri/src/commands.rs`) and
listens for three events: `daemons_changed` (the registry view, sent after any request that changed
the registry, the local daemon state or a setting), `connection_resume` (`{ reason }`, § Resume
signals) and `transfer_progress` (`{ id, state, done, total }`, § Threads, the transfer engine).
Tauri cannot scope `core:event:allow-listen` to names, so the page could listen to any
event; the app emits only `daemons_changed`, `daemons_manage`, `connection_resume` and `transfer_progress`:

| Command | Does |
|---|---|
| `boot()` | Returns `{app: {title, version, platform: "desktop", minDaemonVersion}, storage, notices, preview, transfers, daemons}`: the stored workbench keys of both scopes merged, the notices (a file that could not be read and was reset, `file_reset`, with `keptAs` `null` when even the rename failed; a version 1 registry's secrets the store would not take, `secrets_not_moved`; or the keychain not being used at launch, `secret_store_fallback` with `reason` `unavailable`, `denied` or `failed`) — each returned once — the preview kind, the launch's `--transfers` mode (`engine` or `page`, fixed for the launch; the page refuses any other value), and the registry view (`currentId`, entries, local state, settings, `secretStore`: `keychain`, `file` or `memory`; no secret). Resets the transfer count and clears the preview store |
| `storage_set(key, value)` | Queues one stored key. It is a synchronous command, so calls are applied in the order the page made them; it answers once queued. Size caps are checked on the owner thread and a refused write is logged with the key only |
| `dialog_confirm(message)` → bool | Native OK/Cancel dialog over the window; the text is capped at 8,192 characters. Closing it, or a failure, answers `false` |
| `dialog_alert(message)` | Native message dialog, same cap |
| `open_external(url)` | Opens the URL with the system opener after `links::check`; a refused or failed open is logged (scheme only) and the page is not told |
| `save_begin(suggestedName)` → `{handle}` \| null | Native save dialog starting in the last folder used this run, else Downloads. The name is reduced to a file name (no path parts, no control characters, at most 255 bytes). Creates `.pistudio-save-<hex>.part` beside the destination, listed in `pending-saves.json`. `null` when cancelled; at most 8 open |
| `save_write(bytes)` | Appends a raw body (at most 16 MiB) to the save named by the `handle` request header |
| `save_finish(handle)` / `save_discard(handle)` | Sync and rename over the destination / remove the temporary file. A handle is single use; errors never contain a path |
| `upload_pick()` → `[{handle, name, size?}]` | Native open dialog for one or more files, shown off the event loop, one dialog at a time, starting in the last folder used this run. Rust keeps each path in `shell::picked` and answers a `handle` (128 random bits, 32 hex digits), the `name` (the last path component, lossy when it is not valid Unicode) and the `size` when the file's metadata could be read. `[]` when the user cancelled. A handle is taken once (`Picked::take`, for the transfer commands); at most 1,024 unused handles are kept (the oldest is dropped) and `boot` drops all of them. No answer holds a path. Errors are `{code, message}`: `engine_off` under `--transfers page` (no dialog is shown), `unavailable` when the build has no open dialog |
| `transfer_upload({id, handle, path})` → `{bytes}` | Uploads the picked file of `handle` (from `upload_pick`; taken once, spent by the call once `id` and `path` are accepted) to `path` on the current daemon, over the engine's own connection (`apps/pistudiodesktop/src-tauri/src/transfers.rs`, § Threads). `id` is 1 to 64 letters, digits or hyphens; `path` 1 to 4,096 bytes. The file is opened and read on the blocking pool; its size is the metadata's at the start of each attempt. Answers when the daemon confirmed the file. Errors are `{code, message}`: `engine_off` (`--transfers page`), `invalid_request` (a bad `id` or `path`, checked before the handle is taken, so the handle is still good), `unknown_handle`, `duplicate_id`, `source_unreadable`, `cancelled` and the rest of the engine's codes (spec § Error handling). No message holds a local path, a handle or a password |
| `transfer_save({id, handle, path})` → `{bytes}` | Saves the daemon's file at `path` into the open save of `handle` (from `save_begin`). The engine claims the save (`Saves::claim`): from then on the page's `save_write`, `save_finish` and `save_discard` answer an unknown handle for it, and the engine finishes it (rename into place) or discards it on any failure or cancel. Answers `{bytes}` once the file is in place. Errors as for `transfer_upload`, plus `destination_busy` (another claimed save writes the same destination; this save is discarded) and `disk` |
| `transfer_cancel({id})` → `{cancelled}` | `{cancelled: true}` for a transfer that was queued, waiting or running (its own command answers `cancelled`), `{cancelled: false}` for any other id. A cancel that reaches Rust before its transfer is not lost: when no transfer has the `id`, the cancel is remembered for 10 s (at most 64 ids, the oldest dropped first, ids longer than 64 bytes not at all), and a `transfer_upload` or `transfer_save` of that id that arrives within it settles as `cancelled`, its save discarded and its handle spent. Under `--transfers page` all three transfer commands answer `engine_off` |
| `transfers_set(count)` | The page's count of uploads and saves in flight. Closing the window while it is above zero asks first ("N file transfer(s) are still running. Quit anyway?") |
| `preview_mount(html)` → `{url}` | Mounts an HTML document at the preview origin. An error on an `inert` platform or past the caps; the error never contains the document |
| `preview_release(url)` | Drops a mounted document; an unknown URL is ignored |
| `engine_command(id, params?)` | Runs one of twelve allowed engine ids (`daemon.list/add/update/remove`, `daemon.local.*`, `daemon.remote.start/refresh`, settings); anything else, including `daemon.switch` and `command.list`, is refused |
| `daemon_resolve_current()` | What to dial for the current entry: `{url, connect: true}` or an error code; never a secret, without exception. `url` is the entry's address for a `local` or `direct` entry, the relay's WebSocket address for a `relay` entry (`ws(s)://<relay host>`, or `ws://<host>` for a link with a host hint: Rust reads the link on the blocking pool and answers `engine::relay_address`, never the link) and `ws://127.0.0.1:<daemonPort>` for an `ssh` entry. The page does not dial it: it hands it to `transport_open`, which checks it against the entry. Starts a stopped local daemon when auto-start is on. A local, direct or SSH entry's answer reads nothing from the secret store, so a missing or unreadable password shows at `transport_open` (`secret_missing`, `secret_unavailable`); a relay entry's answer reads the link, so a missing, unreadable or unparsable link shows here (`secret_missing`, `secret_unavailable`, `invalid_link`) |
| `transport_open(url)` → `{localUrl}` | Opens the proxied connection to the current entry's daemon, whatever its kind (`apps/pistudiodesktop/src-tauri/src/transport.rs`, `Route`, which the transfer engine's connector shares). One question to the owner thread (`LocalOp::Bridge`, answered by `Session::plan_bridge`: the entry's id and kind, the address to dial, where the password or link is); then the route for the kind (`Route::resolve`: a relay entry's link is read on the blocking pool and parsed, `secret_missing`, `secret_unavailable`, `invalid_link`; an SSH entry's fields are asked of the owner thread, `LocalOp::Ssh`), and in order: `address_mismatch` unless `url` is exactly the address rule (`address_matches`) applied to the route's address, `invalid_address` (`net::check_address`: only `ws:`/`wss:`, no user information), `limit` when four proxied connections exist (`Proxies::reserve`, before any dial), the calling webview's origin (read from the webview: `tauri://localhost` on Linux and macOS, `http://tauri.localhost` on Windows), then the socket by kind. A local, direct or SSH entry's password is read from the secret store on the blocking pool (`secret_missing`, `secret_unavailable`). A local or direct entry is dialled within 15 s (`unreachable`, `tls`, `unauthorized`, `host_not_allowed`, `handshake`, `timeout`; the password is the `pi-studio.bearer.<password>` subprotocol). A relay entry goes through `relay::connect` within 15 s (the SDK's eight reasons as codes: `relay_unreachable`, `daemon_offline`, `daemon_unresponsive`, `too_many_clients`, `daemon_outdated`, `wrong_key`, `protocol_error`, `timeout`); a link with a host hint is dialled with `net::dial` and no password. An SSH entry opens a channel of the one shared SSH session (`ssh_session.rs`, opened if needed) and runs `net::dial_over` on it (`unreachable`, `timeout`, `host_key_unknown`, `host_key_changed`, `known_hosts`, `auth_failed`, `passphrase_needed`, `key_unreadable`, `ssh_config`, `forwarding_refused`, `daemon_not_running`, `ssh_lost`, and the dial's codes). Last `Reservation::open(socket, origin)` (`proxy_failed`). `localUrl` is `ws://127.0.0.1:<port>/<token>`: single use, valid for 10 s, in this answer and nowhere else. A local entry whose daemon is not running answers the codes of `daemon_resolve_current` (`local_not_ready` while it starts or has to be started). An SSH entry that fails with `daemon_not_running` also queues one probe of the host's daemon (§ The registry and the local daemon). Errors are `{code, message}`; no answer, error or log line holds a password, a link, a host name or the token. `boot`, `daemon_switch` (after the confirm, before the reload) and the window closing (and the app's exit) close every proxied connection: each daemon is told 1001 |
| `ssh_config_hosts()` → `{hosts: [{alias, hostName?, user?, port?, identityFile?, jump?}]}` | The plain `Host` names of `~/.ssh/config` and its includes, in file order, at most 256, for the SSH form of the Daemons screen (`SshSessions::config_hosts`, read on the blocking pool; the file is read, never written). An absent file is an empty list; a file that does not parse is refused with `ssh_config`. An unknown SSH host key is not a command: a connect that fails with `host_key_unknown` makes Rust ask in a native confirm (host, port, key type, SHA-256 fingerprint, and whether it is a jump host), once per key per page load; OK stores the key in the app's `known_hosts` and emits `connection_resume`, Cancel is remembered until `boot` or a switch |
| `daemon_switch(id)` | Switches the current entry: unknown id → `not_found`; transfers running → native confirm ("N file transfer(s) are still running. Switch anyway?", "no" answers `cancelled`); then the old page's file transfers are cancelled and its connections closed (`switch_to`'s `leave`, before the registry changes), `daemon.switch` (flushes the entry left, records `lastUsedId`) and the page reloads. From the switch until the next `boot`, `storage_set` is dropped: the page being left writes its layout as it unloads, and that write would otherwise replace the new entry's. The native menu uses the same path |

The page never names a path: the destination comes from the native dialog and stays in Rust. A
temporary file left by a killed app is removed at the next launch, and a damaged journal can only
remove files named `.pistudio-save-*.part`.

Tauri enforces the list: `build.rs` declares the commands in the app manifest, and
`capabilities/default.json` grants their `allow-*` permissions and nothing else — no `core:` and no
plug-in permission (the opener plug-in is registered with its link-click script off). A command
not on the list is refused before it runs. Adding one means three places: `build.rs`, the
capability and `generate_handler!`; a test asserts the exact capability list.

The owner thread writes the changed scope's file one second after the first unwritten change
(later changes ride along), and once more at `RunEvent::Exit`, waiting at most five seconds. A
signal kill (SIGTERM, a crash) skips that last write.

The window also refuses to leave the app: `shell::navigation::allows` admits only the app origin
(`tauri://localhost`, `http(s)://tauri.localhost`) and, in a dev build, the dev server; a refused
navigation is logged with scheme and host only. Window-level file drops are off
(`dragDropEnabled: false`) so the page's HTML5 drops reach the workbench. A second launch focuses
the first window and exits (`tauri-plugin-single-instance`, registered first; on Linux it needs a
D-Bus session bus).

## The registry and the local daemon

**The registry** is `daemons.json`, version 3: the entries (`local`; `direct` with an address; `relay`;
`ssh` with `host`, `user?`, `port?`, `identityFile?`, `jump?` and `daemonPort`; `hasPassword` on
`local`, `direct` and `ssh`, `hasSshPassword` and `hasPassphrase` on `ssh`) and `lastUsedId`. No secret
is in it. A version 2 file is read and rewritten as version 3; a newer file is set aside like any
unknown version. The rules and caps are in `crates/model/src/registry.rs` (a name of 1–64 characters,
unique without regard to case; an address at most 2,048, a password 1,024 and a pairing link 4,096
characters, the link having to parse (`model::pairing`, `invalid_link`); an SSH host 1–255 characters
without whitespace, a user at most 64, a port 1–65535, a key-file path at most 4,096, a jump list at
most 1,024 and a daemon port 1–65535, default 6767; at most 64 entries). The file is written with
`store::write_private`: the temporary file is created at mode 0600 on Unix, so it is never readable by
others, and a `*.corrupt-*` copy keeps that mode. Views (`EntryView`) carry `hasPassword`, never a
secret; an SSH entry's view has `address` (`[user@]host[:port]`) and `ssh`. `daemon.list` also carries
`remote`, the state above for the current SSH entry and `null` otherwise.

**The supervisor** (`crates/shell/src/supervisor.rs`) runs the local daemon through the installed
`pi-studio` CLI. The engine cannot run a process, so `daemon.local.start`, `.stop`, `.restart` and
`.refresh` only queue a request and answer `{ accepted: true }`; a background runner thread takes
the queue through `LocalAccess` (a few short requests to the owner thread, so storage, the control
socket and the dialogs keep answering during a start), runs the CLI one call at a time, and hands
the resulting `LocalState` back as a state change. A launch queues one refresh and does not wait
for it; the state is `checking` until it ends. To find the CLI it reads the environment of the
user's login shell once per run (`$SHELL -l -i -c`, random markers around `env`, 5 s limit, the
app's own environment on failure; Retry reads it again), then looks at `cliPath`, `PATH`, and the
per-user and system install directories of npm and the Node version managers
(`cli_find.rs`). A CLI older than 0.0.127 is `cli_outdated` and runs no daemon command. Each
call has its own limit (`--version` and `status` 5 s, `start` and `restart` 90 s, `stop` 15 s), a
timed-out process group is killed, and the answer is the last non-empty line of standard output
read as JSON whatever the exit code. The CLI's `pairingUrl` is discarded where the line is parsed.
Quitting the app never stops the daemon. On Windows none of this runs (`unsupported`).

**The SSH entry's daemon.** The engine keeps the `RemoteState` of the current SSH entry's daemon in
memory (`unknown`, `checking`, `running`, `stopped`, `not_installed`, `cli_outdated`, `starting`,
`failed`; reset when another entry is opened) and a queue of requests (`daemon.remote.start`,
`daemon.remote.refresh`, and the probe a `transport_open` that failed with `daemon_not_running`
queues); like the local supervisor it runs no process. `shell::remote_supervisor` (native only) works
the queue one request at a time through `RemoteAccess` (the app's `RemoteOwner`, over `LocalOp::Ssh`)
and `Services::remote_run`, a hook the app fills with a command run over the shared SSH session:
`"$SHELL" -lic '<begin marker>; <command>; <end marker with the status>'`, fresh random markers each
time, answering what lies between them (a login shell, interactive, because on Debian and Ubuntu
`.bashrc` returns early otherwise and nvm's `pi-studio` is not on the PATH). A probe runs
`pi-studio --version` (15 s): not found is `not_installed`, below 0.0.127 `cli_outdated`, otherwise
`running` when the app's last open reached the daemon and `stopped` when it did not. Start runs the
same check, then `pi-studio --json -H 127.0.0.1:<daemonPort> daemon start` (90 s; `-H` because
`daemon start` listens where `-H` says), read by `cli_answers` as the local supervisor reads it
(`up` is `running`; otherwise `failed` with `not_healthy`, `timeout` or `bad_output`; `exec_failed`
when the command could not be run, `no_shell` when the account runs no commands); `pairingUrl` is
discarded. After a successful Start Rust emits `connection_resume`, so the page connects again. A
start is never run without the button. A log line holds the action and the state code; the output of a
remote command is never logged.

**The native menu.** `menus::daemons_menu` turns the registry view into the "Daemons" menu (one
check item per entry, "Manage Daemons…", Start, Stop and Restart); `src-tauri/src/menu.rs` draws
it and rebuilds it after every `daemons_changed` on the main thread, and on macOS keeps the
standard App, Edit and Window menus. `ui.inspect` returns the same model. A click on the current
entry does nothing (Rust cannot see the page's connection); on another entry it runs the same
switch as the page (`daemon_switch`); Stop asks first when the current entry is the local one;
"Manage Daemons…" brings the window forward and emits `daemons_manage`. The native items have no
tooltips, so a disabled item's reason is only in the model.

**Secrets.** A direct (or local) entry's password, a relay entry's pairing link and an SSH entry's
three secrets (the daemon's password, the SSH account's password and the passphrase of its key file)
are not in `daemons.json` (version 3: the entry says `hasPassword`, `hasSshPassword`,
`hasPassphrase`); they are in the secret store the session was given (`crates/secrets`; the kinds
include `SshPassword` and `SshPassphrase`). A version 1 file, which held them, is migrated when the
session opens (§ Decisions). They are never logged, never in a control answer, in `boot` or in
`ui.inspect`. A secret reaches only Rust's own dial: `transport_open` and the engine's connector read
it for the entry being opened and never answer it, and no command returns one, without exception (the
page sends one to Rust in `daemon.add` and `daemon.update`, and never gets it back; for a relay entry
`daemon_resolve_current` answers the relay's address, not the link). A dial that finds the item gone
from the store answers `secret_missing`; one that cannot read the store answers `secret_unavailable`
(for a relay link at `daemon_resolve_current` and `transport_open`, for a password at
`transport_open`). A test (`crates/shell/tests/secret_guard.rs`) opens on a version 1 file, runs
commands and the supervisor against marker secrets, drives the page's dial answer and the bridge's
plan through the owner thread for a local, a direct and a relay entry (asserting that no secret is in
any answer, the relay one being the relay's address), scans every answer and log line, and checks that
the file holds none. Removing an entry removes its secrets from the
store and its state file; a `daemons.json.corrupt-*` copy, made when the file could not be read,
keeps the old contents and mode 0600 and **may hold secrets the registry no longer does**: the
app does not delete it. The secret store is chosen once per launch (§ Decisions, "Which secret store
a launch uses"): the app and its CLI take the keychain when it can be used and `secrets.json`
otherwise, and the registry view says which (`secretStore`). The app binary does not open a session
on a real directory before that choice; the memory backend is only for a session without a
configuration directory (tests, `Session::new()`).

**Resume signals.** After a sleep a socket is often dead while nothing has told the page. A
ticker thread in the app binary (`src-tauri/src/resume.rs`) wakes every 2 s and passes the wall
clock and a steady clock to `shell::resume::WakeDetector`, which is pure (no clock read, no `log`,
so it compiles for wasm32): when the larger of the two elapsed times exceeds the 2 s period by 10 s
or more, that is a wake. A wall clock that went backwards is not one; a clock set forward, or a
process that was stopped and continued, is one, which is harmless: the page probes and finds the
connection alive. `shell::resume::ResumeSignals` is one rate limit shared by every reason (at most
one signal let through per 5 s). A refused signal is deferred, not dropped: it stays pending (two
refused signals of one reason are one) and both threads send it as soon as the limit allows (the
network thread shortens its wait to the limit's remaining time). Only emitted events are counted, reported as
`connection.resumeSignals: { wake, network }` in `ui.inspect`. The event is `connection_resume` with
`{ "reason": "wake" | "network" }`; the host's `connection.onResume` listens to it, and the
workbench probes with a 5 s ping and reconnects. Rust closes and probes no socket on a signal.

The network reason comes from a second thread (`src-tauri/src/network.rs`): every 5 s it reads the
addresses of the interfaces that are up, without loopback and link-local ones (`if-addrs`, MIT OR
BSD-3-Clause, native only; one reading takes about 16 µs on Linux). The pure
`shell::resume::NetworkWatcher` takes the readings: a change (an added, removed or replaced
address) is reported once the set has stayed the same for 1 s (the thread then reads every 1 s
instead of every 5 s) and still holds an address. Losing every address is not reported, but the
first address to return is. A reading that fails is skipped and logged once until one works. The log
says that the set changed and how many addresses there are, never which. It emits through the same
rate limit as the wake ticker, so a change within 5 s of another signal goes out when the limit opens.

## Threads

- One thread owns the `AppShell` and so the `Session`. Commands run there.
- The webview's commands and the control-socket threads only forward: each request crosses a
  channel to the owner thread, which answers them one at a time. A click and an automation request
  never race.
- Slow work belongs on a worker that computes from a snapshot and hands back a result the owner
  thread applies as one command.
- A secret-store call may block (a keychain prompt), so it is slow work: the owner thread plans a
  dial and a worker reads the store; `daemon.add`, `.update` and `.remove` store on a worker and
  commit on the owner thread (§ Decisions, "Where a secret-store call runs").
- A proxied connection runs on Tauri's async runtime (one task for the page's listener, then one per
  direction); frames never cross the owner thread or Tauri's IPC. `transport_open` asks the owner
  thread once, for the plan of the current entry, and reads the secret store on the blocking pool.
  `boot` closes the connections on the runtime; `daemon_switch` and the app's exit wait for the
  close (`Transport::close_all_blocking`, at most 5 s) from a thread that is not a runtime worker.
- The SSH session (`src-tauri/src/ssh_session.rs`, `SshSessions`) is one `pistudiodesktop_ssh::Session` for the
  current SSH entry, shared by the page's channel, the engine's and the remote commands. The first open reads the
  secrets on the blocking pool, resolves `~/.ssh/config` and logs in through the hops (the agent socket comes from the
  login-shell environment); opens that come meanwhile share the attempt, and a failed or ended attempt is not reused.
  Every channel holds a lease; the session is closed 30 s after the last lease ended, by `boot` and a switch, when the
  entry is edited or removed (`Notify::ssh_closed`), when the keepalive finds it dead and at exit. A connect never waits
  for a person: an unknown host key fails it with `host_key_unknown`, and afterwards, outside any connect, Rust asks in a
  native confirm (host, port, key type, SHA-256 fingerprint, and whether it is a jump host), once per key per page
  load. OK appends the key to the app's own `known_hosts` (`~/.ssh/known_hosts` is read, never written) and emits
  `connection_resume`; Cancel is remembered until `boot` or a switch; a changed key has no question and is refused.
- The file transfer engine (`pistudiodesktop_transfer::engine::Engine`, wrapped in `src-tauri/src/transfers/engine.rs`
  as `TransferEngine`, managed by Tauri) runs on the async runtime too, with one bulk connection of its own to the
  current entry's daemon, not one of the proxy's four. Each attempt to open it asks the owner thread once for the plan
  of the current entry (`OwnerAccess::bridge_plan`), and opens the socket as `transport_open` does (`Route`, one branch per
  kind: `net::dial` with the password read from the store on the blocking pool; `relay::connect` with the link read the same
  way; a channel of the shared SSH session), with the engine's 16 MiB message limit; a refused plan is final (`no_current`,
  `unsupported`) or retried (`local_not_ready`, `local_stopped`, an owner thread that did not answer, `busy`); the
  connector's own codes are retried or final by `RETRIED` (the app) and `FINAL_CODES` (`transfer`; § Layers, L8).
  The local files are read and written on the blocking pool (`transfers/files.rs`); a save writes through a
  `ClaimedSave`. `transfer_progress` is emitted from the engine's own callback: it is advisory, and the commands'
  answers settle every transfer. Each transfer logs a line at info level on standard error (the app has no log
  file) when it starts and another when it ends or fails, with the transfer's id, kind, daemon path, **local path**,
  bytes, duration and error code; the local path is written nowhere else, and neither a password nor a handle ever is.
  **Leaving.** `boot` (after it closes the proxied connections), a daemon switch (after the question and *before* the
  registry changes, so that nothing waiting to reconnect can find the new entry's daemon: `switch_to`'s `leave`),
  the window's destruction and the app's exit cancel every transfer (each command answers `cancelled`, each save's
  temporary file is removed) and close the bulk connection with 1001. A switch and the exit wait for it together with
  the proxied connections' close, each for at most 5 s (`transfers::close_all_blocking`). **Waking.** The engine's
  wait before its next attempt ends early on `connection_resume` (a wake or a network change, sent by `resume.rs`)
  and on a `transport_open` that succeeded (the daemon is reachable; the engine only serves the current entry).
  `ui.inspect` reads `transfers` through `Services::transfers` (`TransferEngine::inspector`): the engine's snapshot
  as plain data, with the entry id of the last attempt while there is a connection.
- The host reports a refused `transport_open` (and an answer without an address) to the SDK as a close
  (`onClose(1006, "")`, `src/host/proxied-transport.ts`) before it rejects `connect`: the daemon
  client's state leaves "connecting" only on a close, which is what shows the message and Retry in the
  connection bar and lets the reconnect ladder run. A failure of the page's own socket to `localUrl` is
  closed by that socket.
- `ui.inspect` reads the proxied connections through `Services::transports` (a hook the app fills,
  `Transport::inspector`): the owner thread calls it, and it only reads the set's counters under short
  locks. `connection.transports` is the proxy's snapshot (entry id, `via` (`direct`, `relay` or `ssh`; a
  link with a host hint is `direct`), state, four counters, peak bytes held); `connection.ssh` is
  `{state: none | connecting | open, hops, channels}`, with no host, user or fingerprint; `connection.lastError`
  is the newer of the proxy's last abnormal end and the last refused `transport_open`. The shell crate
  holds plain data (`transports.rs`), no socket type.
- A ticker thread (`src-tauri/src/resume.rs`) wakes every 2 s, reads the wall and a steady clock and
  emits `connection_resume`; a watcher thread (`src-tauri/src/network.rs`) reads the interface
  addresses every 5 s and emits it too. Both end with the app (§ Resume signals).

## What stays out of the core

The engine and everything below it contain no tauri, wry or tao types; no window handles or file
dialogs; no `std::fs` outside `cfg(not(target_arch = "wasm32"))`; and no global mutable state. The
shell crate holds to the same rules. Sockets live in `net`, `relay` and `ssh` (the last two open theirs through `net`); only `transfer`, `relay`, `ssh` and an app binary may use `net`, only an app binary may use `transfer`, `relay` or `ssh`, and none of those crates may use tauri, wry or tao (the layer check enforces all three).

## Decisions

Record design decisions here as they are made (which files, where the state
lives, what runs off the owner thread, which windows exist).

| Decision | Choice | Why |
|---|---|---|
| Where the UI and its state live | In the workbench, in TypeScript | One UI for the browser and the desktop; the limits that motivate this app are in the browser sandbox, not in the components (`docs/desktop-client-handoff.md` at the repository root) |
| How the frontend gets the workbench | From source, through Vite aliases to `packages/*/src`, as `packages/web-client` does | A workbench change shows up without building it, and `vite build` needs no package's `dist` |
| Which host the window uses | The desktop host: the browser host with storage, dialogs, links, save-to-disk, preview, the registry, the transport (`connection.createTransport`, through Rust, for every kind of current entry) and `files` (a picker, uploads and saves through the transfer engine: `src/host/transfers.ts`, chosen once when the host is built from `boot.transfers`) replaced by Rust-backed members; the timers, the view URLs, a dropped file and `--transfers page` stay the browser host's. Outside Tauri, the plain browser host | Rust replaces host members one at a time; the snapshot tool and a dev-server browser have no Rust to ask |
| Local daemon | Supervise an installed `pi-studio` CLI (`pi-studio --json daemon start\|stop\|restart`); no bundled daemon for now | Cheap, and reuses the CLI's lifecycle code. A daemon that needs no installed CLI was explored on 2026-11-22 (one Bun-compiled executable the app downloads on first use; `swe/architecture/single-binary-daemon.md`) and is not built; Windows has no local daemon (POSIX-only) and connects to remote or WSL2 daemons |
| Where a secret-store call runs | The session never calls the store on the thread that owns it, except at launch. A read is split in two: the session's `plan_dial` (pure, on the owner thread) answers with a `DialPlan` that is already final (`Ready`), names the item to read for a relay entry (`PairingLink { entry }`), or, for a local or direct entry, carries a `BridgePlan` (`Open`: the entry, the address, where the password is); the caller finishes it (`DialPlan::finish(&dyn SecretStore)`) on its own thread, and that reads the store for a pairing link only, never for a password (`Dial::Connect` has no password field: the page is told the address). The supervisor's `OwnerAccess` holds the session's `Arc<dyn SecretStore>` (`Session::secret_store()`). The bridge's dial reads the password the same way: `Session::plan_bridge` answers that `BridgePlan` (entry, url, `BridgePassword::{None, Held, Stored}`) and `BridgePlan::read_password(&dyn SecretStore)` runs on the blocking pool (`OwnerAccess::bridge_plan` / `bridge_password`). Migration of a version 1 `daemons.json` runs once in `Session::with_config_dir`, before the owner thread has answered anything. `daemon.add`, `daemon.update` and `daemon.remove` are split the same way into a `SecretJob`: `Session::plan_secret_command` (pure, validates, builds the job), `SecretJob::store` (the calls that come before the file: set a secret, delete a cleared password; caller's thread), `Session::commit_secret_job` (planned again against the registry as it is then, written; under the lock) and `SecretJob::finish` (the calls after it: a removed entry's items, or taking back an added entry's secret when the file would not write; caller's thread). The owner loop (`shell/src/deferred.rs`) runs the store steps on worker threads and answers the asker when the job is done, so the page, the control socket and `OwnerAccess` need no change; `execute_unlocked(&Mutex<Session>, ..)` does the same for the CLI. `Session::execute` still runs the steps in a row (blocking) for a caller that owns its thread. A delete that fails on remove is logged with the entry id and the store's code, and the answer carries `notices: [{kind: "secret_not_removed", entry}]`; the entry is removed all the same | A keychain call can block on a system prompt, and the owner thread must keep answering storage writes, the control socket and dialogs meanwhile. A plan that names the item keeps the engine free of a thread or a hook it would have to wait on, and the owner never waits: a store that blocks 3 s holds up nothing, and an `add`/`update`/`remove` against a slow store answers other requests meanwhile (`owner_access.rs` tests). A direct entry's page dial makes no store call at all, so a connect asks a keychain once (for `transport_open`), not twice. Committing against the registry as it is then, not as it was planned, keeps two commands that overlap from overwriting each other's file write; the owner loop polls every 20 ms only while a store step is outstanding, and at quit waits up to 30 s for those |
| A migration the store refuses | The version 1 file is left byte for byte as it was, this run serves its secrets from memory, and one `secrets_not_moved` notice is returned. While they are held, `daemon.add`, `.update` and `.remove` answer `secret_store_failed` and a switch does not rewrite the file | A version 2 file would claim secrets that only this run has: writing it would lose them when the app closes. The next launch tries again |
| Which secret store a launch uses | `--secret-store keychain\|file`, else the keychain when it can be used, else `secrets.json` in the configuration directory (`shell/src/secret_choice.rs`, shared by the app and its CLI). "Can be used" is a check on a thread of its own, within 2 s in all: the platform store is opened and a missing item read (`KeychainStore::probe`), then a throwaway item (fixed name, deleted at once, also when the launch has stopped waiting) is written and deleted. A refusal, no answer or a failure means the file, with a `secret_store_fallback` notice that names the code (`unavailable`, `denied`, `failed`); `--secret-store keychain` fails the launch instead, naming the option; `file` never touches the keychain. The check starts before the window is built (the keychain's scope depends on the arguments alone) and is collected after the configuration directory is known (the file store needs it); no session opens a directory before that. The kind chosen is `secretStore` in the registry view (`boot`, `daemons_changed`) and in `ui.inspect` (`connection.secretStore`) | The read alone passes on a Secret Service whose default collection is locked or absent, and the first real `set` would then fail with `denied`: only a write finds that out. A prompt (macOS) must not hold up the window, so the wait is bounded and the window opens on the file. Scratch runs pass `file` so that no check writes to a person's keychain |
| A store job still waiting at quit | The owner loop waits up to 30 s (`deferred::DRAIN`) for an outstanding `daemon.add`, `.update` or `.remove` store step, then ends without it: the job is dropped and its entry is not written. A secret the step had already stored may stay in the store with no entry (nothing removes it later) | A keychain call that waits on a prompt must not keep a quitting app alive for ever. The loss is at most one orphan item, never a secret in a file or a log |
| How the page reaches a daemon | A loopback WebSocket proxy owned by Rust (`net::proxy`), not a Tauri channel, for every kind of entry: the page asks `transport_open`, Rust opens the daemon's socket (a dial with the password read in Rust, the relay's sealed channel, or a channel of an SSH session) and answers a single-use `ws://127.0.0.1:<port>/<token>`; the page's own `WebSocket` connects there | The channel design failed the benchmark gate on Windows and macOS (`swe/notes/desktop-ipc-benchmark.md`); the proxy met every mark but one memory mark that the webview's own socket misses by more. Every secret stays in Rust; the page handles only the token, for at most 10 s. The channel candidates stay in `apps/ipc-bench` |
| Rust dials before it answers | `transport_open` answers only once the daemon's socket is open, so a refused open is the command's error with its real reason; the host then reports it to the SDK as a close (1006) before the promise rejects | A browser socket cannot say why it failed; the daemon client leaves "connecting" only on a close, so without the close the bar would never show the message or Retry |
| What Rust holds | A direction reads its next messages only after the write of the previous ones completed: at most a 256 KiB or 64-message batch and one message per direction. A page that stops reading is not protected; the webview buffers, as today | Bounds Rust without a window protocol; transfers leave this connection in milestone 3 |
| Where uploads and saves run | In Rust (`pistudiodesktop-transfer`, layer 8), on one bulk connection that the first transfer opens and 30 s of idleness closes: a second session of the same daemon (`daemon_status` lists it as a `browser` client with `platform: "desktop"`, `agentStreams: "none"` and `appVersion: "pistudiodesktop/<version>"`), not one of the proxy's four. At most three transfers run at once and the rest wait in order; the page asks, shows a percentage and can cancel, and never holds the bytes | A 1 GiB upload grew the page by about 2 GiB, and a save crossed Tauri's IPC chunk by chunk, both on the socket that carries the terminal and the chat. Seen live (2026-11-22, `docs/development.md` § The transfer engine in the real webview): three running and the fourth `queued`, the second client present during a transfer and gone 30 s after the last one |
| Dialogs of a transfer | `upload_pick` and `save_begin` show the platform's file dialog (on Linux GTK's "Open File" and "Save File", one at a time with the confirm and alert dialogs: they share one lock). A second dialog waits behind the first, also when the first is a confirmation nobody has seen yet | One native dialog at a time is what the platforms allow. Seen live: the explorer's "Overwrite this file?" question is a native confirm in the desktop app, and a transfer that needs a pick or a destination waits for it |
| What a dropped connection does to a transfer | The engine retries for as long as the app runs (backoff 1 s doubling to 30 s, cut short by `connection_resume` and by a successful `transport_open` for the same entry): a save continues from the bytes in its temporary file with `ifUnchanged`, an upload starts again from byte 0 under a new `transferId`. An error a retry cannot fix (`unauthorized`, a refused plan, `changed`, `source_changed`) fails at once and removes the temporary file | Seen live: a cut connection, a `kill -9`ed daemon and a daemon stopped for 10 minutes each resumed a save or restarted an upload with the right hash; a refused password failed 41 ms after the dialog; a daemon file changed while the save waited failed with "The file changed on the daemon." and left no temporary file |
