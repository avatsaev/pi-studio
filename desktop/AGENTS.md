# AGENTS.md

Pi Studio Desktop is the native client for a Pi-Studio daemon: a Tauri window whose webview runs
the workbench (`@av-pi-studio/workbench`, the same UI as the browser client), and a Rust side for
what a browser does badly: sockets, files on disk, secrets and OS integration. Read
`docs/architecture.md` next.

**Where it stands.** Milestone 1 (the native host and the daemon registry) is built and checked
live on Linux; on macOS and Windows only the automated checks have run (GitHub runners, 2026-11-20:
`.github/workflows/desktop-platform-checks.yml`; `docs/platform-checks.md` lists them and what a person
still runs). The window draws the workbench with a desktop host: at start the page calls `boot` (the
stored workbench keys, the registry view, the preview kind), and every storage write goes back
through `storage_set` to the Rust engine, which writes the files in the configuration directory.
Confirm and alert dialogs, external links and save-to-disk are native, through Rust commands, and
the HTML preview is served from an origin of its own. The engine holds the daemon registry
(`daemons.json`, version 2, mode 0600, no secret in it; local, direct and relay entries; the secrets
are in a store the engine is given: the keychain when it answers, else `secrets.json`; `--secret-store`
forces one) and the settings; a supervisor runs
the installed `pi-studio` CLI to start, stop and restart this machine's daemon. The window opens on
the entry used last; a native Daemons menu and the workbench's switcher and Daemons screen switch,
add, edit and remove entries, each with its own stored layout. All of it sits behind a command
registry that the page, the CLI and the control socket dispatch into. The socket to a local or direct
entry's daemon is Rust's (milestone 2): the host's `connection.createTransport` (`src/host/connection.ts`) returns, for
a current entry of kind `local` or `direct`, the SDK's WebSocket transport pointed at the single-use loopback
address that the page's command `transport_open` answers after Rust dialled the daemon (`src/host/proxied-transport.ts`,
`src-tauri/src/transport.rs`); a relay entry, or no current entry, keeps the webview's own socket. A
refused `transport_open` is reported to the SDK as a close (1006) after the rejection, as the SDK's own
transport does for a failed connect: the daemon client leaves "connecting" only on a close, so without
it the connection bar never shows the message or Retry. Checked live on Linux (2026-11-22,
`docs/development.md` § The transport proxy in the real webview). The runner workflow also checks it
on macOS (the local daemon's transport, the wake signal, the login keychain) and on Windows (a stand-in
daemon, the wake signal, the Credential Manager); those checks are written and tested on Linux and wait for their first run.
Known gaps: a layout change in the last ~250 ms before the window closes is lost; the Upload
picker and a file dragged from the OS were not verified in the headless container.

This directory is the Cargo workspace root, inside the pi-studio monorepo: every path and command
in this file is relative to `desktop/`. The frontend (`apps/pistudiodesktop`) is an npm workspace
of the repository root, so its dependencies are in the root `package-lock.json`: install them with
`npm ci` at the repository root, never here.

If the `av-rust-desktop-*` agent skills are installed, use them: `av-rust-desktop-develop` for
everyday changes, `av-rust-desktop-architecture` for the rules in depth.

## Workspace map

    crates/model            L1  the settings, the daemon registry and one entry's stored state: pure data; the address rule (`address_rule.rs`: `normalize_daemon_url`, `address_matches`, the Rust twin of the workbench's `normalizeDaemonUrl`, tested over the same `packages/workbench/src/lib/connection/normalize-url.vectors.json`)
    crates/store            L3  JSON files: safe reads, atomic writes
    crates/secrets          L3  the secret store: OS keychain (service `com.avatsaev.pi-studio`, one `keyring-core` store crate per platform by `cfg`; `KeychainStore::probe` answers within 2 s), file (`secrets.json`, 0600) and memory backends, and `FakeKeychain` (can block) for tests; the choice between them is the shell's
    crates/engine           L5  Session + command registry (every action is a command)
    crates/shell            L6  UI state, generated menus (incl. the Daemons menu), control protocol, the page's commands, the local-daemon supervisor, the launch choice of the secret store (`secret_choice`), resume signals (`resume`: the pure wake and network-change detectors, the rate limit that defers a refused signal instead of dropping it, the counts; the app's threads are `src-tauri/src/resume.rs` and `network.rs`, the latter reading addresses with `if-addrs`), the proxied connections as `ui.inspect` shows them (`transports`: plain data and serde only; the app fills `Services::transports` with a hook, so the crate holds no socket type) (no UI toolkit)
    crates/net              L7  sockets (the only crate with one); native only, empty and dependency-free on wasm32; only `transfer` and an app binary may use it, and it may use no UI crate. `dial(url, password, time_limit, max_message_bytes)`: TCP, TLS trusting only the OS store, the WebSocket upgrade with the bearer subprotocol, error codes; `check_address` is its address check alone. `proxy`: the loopback WebSocket proxy (`Proxies::reserve` before the dial, `Reservation::open(daemon_socket, origin)` after it answers `ws://127.0.0.1:<port>/<token>`; the gate, the two-direction pump with a bounded hold, the close table, a set of at most four connections, `close_all`, `snapshot`). `limits.rs` holds every limit and `Limits` lets a test shorten one; the crate has no log (the app gives the proxy a function for its lines)
    crates/transfer         L8  the transfer engine (so far: `limits.rs` holds every limit and `Limits` lets a test shorten one, `error.rs` the one `Error` enum (`Dial`, `UnsupportedDaemon`, `Protocol`, `Timeout`, `Rpc`, `Closed(Ended)`, `Internal`; `Ended` is `Local`, `Remote(code)`, `Silent` or `Socket`), `wire`: the daemon's frames with no socket or state; `wire::outbound` builds the text frames (`hello`, the upload, download and cancel requests, `ping`, `pong`), `wire::inbound` reads `Inbound::parse(text)` no further than needed (`ServerInfo`, `Reply` with typed readers for the three answers, `RpcError`, `UploadComplete`, ping, pong, `Other` by its type), `wire::binary` builds an upload's `Begin`/`Chunk`/`End`/`Error`, `decode`s a download's and says with `is_file_transfer` whether an opcode is `0x10`–`0x13`; every number from the daemon is 0 to 2^53 − 1 kept as `u64`, a broken frame is `Error::Protocol` and never repeats the daemon's words; its tests read the fixtures in `packages/protocol/fixtures/external-clients/` and run a seeded hostile loop); `connection`: the bulk connection. `Connection::open(WebSocketStream<S: Transport>, &Hello, Limits)` takes the socket `net::dial` gave (or any stream a test has), sends `hello`, waits for `server_info` and requires its three flags (`Error::UnsupportedDaemon` otherwise), then starts a reader task and a writer task. `request(build)` sends a `session` frame with a fresh `requestId` and returns its answer, its `rpc_error` as `Error::Rpc`, or `Error::Timeout` after the answer time for that request alone. `send_text` and `send_binary` return when the frame is on the socket. `expect_upload(transferId)` gives an `UploadWait` for the one `file_upload_complete` with that id. `download()` takes a stream id from 0 to 255 and gives a `Download` whose `next()` returns `Delivery` values (a `Frame` and its share of the hold): the reader takes no frame off the socket while the consumer holds more than `download_hold_bytes` unreleased, so memory stays flat and the other transfers wait behind a slow one. The reader sends one `ping` after `ping_after` with no frame of any kind and drops the connection (`Ended::Silent`) after `dropped_after`; time spent blocked on a consumer does not count. A message above 16 MiB, text that is not UTF-8 or a frame `wire` cannot read ends it with `Error::Protocol` (close 1002); text and binary frames nobody awaits are ignored. However it ends, every waiter is told once with the reason (`Error::Closed(Ended)` or the protocol error; a download first gets what was queued), `ended()` waits for it, `close(Close::Normal | Close::GoingAway)` waits `close_wait` for the daemon's close frame, and dropping the connection ends it as `Local` with a 1001 close. Closing an idle connection, reconnecting and the queue are the engine's, not the connection's. `tokio`, `tokio-tungstenite` and `futures-util` are normal native dependencies; its tests run over an in-memory pipe to a scripted daemon on a paused clock (nothing sleeps for real) and over a real socket against the stand-in, where the 10 s and 30 s cases freeze the clock and move it by hand; `testing` (the `testing` feature and this crate's own tests only; an app lists the feature in its `[dev-dependencies]`, so a release build has none of it): `StandInDaemon::start()` / `start_with(Config)` is a WebSocket daemon in the test's process on `127.0.0.1` (OS-assigned port, `url()`) that answers the upgrade (an optional password, else 401), `hello` with a `status` whose feature flags are `Config::features`, `ping`, uploads into memory (kept at their path only when `End` arrived; `file_upload_complete` on `ack`) and downloads from memory (`offset`, `length`, `ifUnchanged`, the real refusals, cancel answered before its `Error`), and misbehaves as `script(Fault)` says (close, reset, stop reading or answering after a count of bytes or frames, `ok: false` with a chosen error, `rpc_error`, a request left unanswered, a failed upload, a wrong `bytesWritten`, a download's frames out of order, oversized, too long, cut or an `Error` first); `put_file`, `file`, `uploads()` and `hellos()` let a test set up and read the state; its tests pin every frame it sends to the fixtures; native only, empty on wasm32; it dials through `net`, and only an app binary may use it, and it may use no UI crate
    crates/testkit              test helpers
    apps/pistudiodesktop                  the web frontend: a shell that mounts the workbench
    apps/pistudiodesktop/src-tauri        the desktop binary: Tauri window, dialogs, control server, the proxied daemon connections (`transport.rs`: `transport_open`, closing them on `boot`, a switch and exit, and the `Services::transports` hook behind `connection.transports` / `connection.lastError` in `ui.inspect`: the proxy's snapshot plus the last refused open, the newer error wins)
    apps/pistudiodesktop-cli              headless CLI
    apps/ipc-bench                        the IPC benchmark: baseline, two candidate bridges and a loopback WebSocket proxy, B1-B8 incl. echo under load and a hidden window with a 2 s Rust tick (exempt from the layers; uses `net` for its message limit and holds the channel candidates' codec, window and order buffer; own page in page/, no npm package; never bundled or released; `docs/development.md` § The IPC benchmark)
    xtask/                      cargo xtask layers | web | wasm | test | ci

Layering is enforced by `cargo xtask layers`. Register a new crate in `xtask/src/layers.rs`.

## Golden rules

1. The UI is the workbench. `apps/pistudiodesktop/src` only mounts `@av-pi-studio/workbench` and
   gives it a host (`WorkbenchHost`). View state (sessions, timelines, panes, settings) lives in the
   workbench, in TypeScript, shared with the browser client: change the UI in `packages/workbench`,
   not here. This package makes no network call and stores nothing of its own (oxlint enforces
   it); what the platform must do is a member of the host.
2. Never crash. Non-test Rust code has no unwrap, expect or panic, and no unsafe. Return errors.
   Input is hostile: check bounds, cap sizes, bound recursion. A crash fix ships with a test that
   panicked before it.
3. Everything the Rust side does for a user is a command, in `crates/engine/src/*_cmds.rs`, with
   id, label, menu, shortcut, params doc, `enabled`, `run` and tests. The CLI and the control
   channel dispatch ids.
4. A crate depends only on lower layers. Nothing below the app binary uses tauri, wry or tao.
5. The workbench owns what the window shows. Colours, sizes and themes come from the design system
   (`@av-pi-studio/ui-library`); this package adds no tokens. Look at a rendered image
   (`npm run snapshot`) before calling a UI change done.
6. The webview gets the least it needs: it may call only the commands the build script's app
   manifest lists and the capability grants (`docs/architecture.md` § The webview boundary); no
   plug-in permission and no `core:` permission except listening to events (Tauri cannot scope it
   to names), no remote content in the main window, navigation only within the app origin, and a
   Content-Security-Policy that lists exactly the sources the workbench uses (`app.security.csp`
   in `tauri.conf.json`). Add a source or a command only with the feature that needs it;
   `npm run snapshot` fails when the page breaks the policy.
7. Never break wasm. File-system code is `cfg(not(target_arch = "wasm32"))` (the engine reads and
   writes the app's files through the `store` crate, which is empty on wasm32) or behind
   `Services`.
8. Tests are the gate. Every change comes with tests.
9. Permissive licences only, for crates and npm packages alike. Check a dependency's licence
   before adding it; record every bundled asset in `ATTRIBUTION.md`. Known exception, not yet
   decided: the workbench and `@av-pi-studio/ui-library` are AGPL-3.0 and are bundled into the app.
10. Secrets (a direct entry's password, a relay entry's pairing link) live only in the secret store
    (`crates/secrets`), never in `daemons.json` (version 2: `hasPassword`); the CLI's `pairingUrl` is
    discarded. They are never logged, never in a control answer, in `boot` or in `ui.inspect`. A
    password never reaches the page: `daemon_resolve_current` answers `{url, connect: true}` for a
    local or direct entry, and `transport_open` reads the password itself, in Rust, for its dial and
    answers none (`Dial::Connect` has no password field; `tests/secret_guard.rs` fails if an answer
    gets one back). The one secret a command still returns is a relay entry's pairing link, as the `url`
    of `daemon_resolve_current`, because a relay entry keeps the webview's own socket until
    milestone 4. A store call
    may block: the session never makes one on the owner thread (it plans a dial, `DialPlan`, and the
    caller reads the store; `daemon.add/update/remove` are a `SecretJob` whose store steps run on
    worker threads, `deferred.rs`), except at launch, where a version 1 file's secrets are moved.
    Which store a launch uses is chosen once, by `shell/src/secret_choice.rs` (shared by the app and
    its CLI): `--secret-store keychain|file`, else the keychain when a check (open, read a missing
    item, write and delete a throwaway one; 2 s in all, on its own thread) passes, else `secrets.json`
    with a notice; the app never opens a real configuration directory before that. Every automated
    or live run passes `--secret-store file`, so that none writes to a developer's keychain; the two
    exceptions are the runner workflow's keychain checks (`macos-keychain.mjs`, `windows-bridge.mjs`
    in `apps/pistudiodesktop/scripts/platform-checks`: `--secret-store keychain`, a scratch
    `--config-dir`, on GitHub's throwaway machines, deleting what they wrote; a unit test pins that no
    other script names the option). The kind
    is `secretStore` in the registry view and `connection.secretStore` in `ui.inspect`; nothing else
    of the store is shown. A `*.corrupt-*` copy of the file keeps its mode and may hold old secrets.

## Conventions

- Command ids (`<area>.<verb>`, camelCase) and control methods are public API. Never rename one
  after a release.
- An error says what was wrong and, where possible, what would be right.
- A command that cannot run now returns the reason: it is the menu item's tooltip and the message
  an agent reads.
- A check that looks removable carries a comment saying what it prevents.
- Machine names are lowercase (`pistudiodesktop`); everything a user reads says `Pi Studio`.

## Before you finish

    cargo test -p <crates you touched>
    cargo clippy -p <crates> --all-targets -- -D warnings
    (cd apps/pistudiodesktop && npm run check && npm run lint && npm test)     # when the frontend changed
    cargo xtask ci

Stop and ask before anything hard to undo: publishing, releases, secrets, spending money,
destructive git.
