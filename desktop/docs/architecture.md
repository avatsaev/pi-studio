# Architecture

A Tauri window whose webview runs the workbench (`@av-pi-studio/workbench`, the UI shared with the
browser client), and a Rust workspace in enforced layers with all platform code at the edge.

Two halves, joined by the page's commands (§ The webview boundary):

- **The window.** `apps/pistudiodesktop/src` mounts the workbench and gives it a host
  (`WorkbenchHost`, `packages/workbench/README.md`). The desktop host is the workbench's browser
  host with the members Rust backs replaced: storage, dialogs, links, save-to-disk, the HTML
  preview and the daemon registry. The webview still opens the WebSocket to the daemon itself and
  the browser host's upload and view URLs stay; Rust takes over the rest (transport, file
  transfer, secrets) in later milestones. Outside Tauri (the snapshot tool, a browser on the dev
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
| L1 | `model` | The settings, the daemon registry and one entry's stored state, as plain serde data with the limits that keep them valid; the address rule (a stored address to the `ws`/`wss` URL the workbench opens), checked against vectors shared with the workbench |
| L2 | none yet | Domain algorithms written as pure functions over L0 and L1 data |
| L3 | `store` | JSON files: read with a fallback when corrupt, written atomically. Knows no document type; empty on wasm32 |
| L4 | none yet | Mapping the model to and from foreign formats; a plug-in host |
| L5 | `engine` | `Session`, the command registry, the daemon registry, the settings and the stored workbench keys: the façade every frontend talks to |
| L6 | `shell` | UI state, the menu bar generated from the registry (the Daemons menu included), shortcuts, the control protocol, the page's commands, and the local-daemon supervisor. No UI toolkit: it produces the view as data |
| L7 | `net` | Sockets: the dial and the loopback proxy. `dial` opens a WebSocket to a daemon within a time limit (TCP with `TCP_NODELAY` and keepalive; TLS by `rustls` with the `ring` provider, the certificate judged by the operating system's verifier through `rustls-platform-verifier`, no option to accept an untrusted one; the upgrade with the `pi-studio.bearer.<password>` subprotocol; a message limit of 128 MiB set on the socket) and fails with a code (`invalid_address`, `unreachable`, `tls`, `unauthorized`, `host_not_allowed`, `handshake`, `timeout`) and a message that never holds the password. `proxy` takes an open daemon socket and the page's origin and answers a single-use local URL `ws://127.0.0.1:<port>/<token>`: a listener of its own on a port the system chooses, closed when the page's upgrade is accepted or after 10 s; a token of 256 random bits compared in constant time; the `Origin` and `Host` checked; a bare 403 for anything else, which does not use the token up; at most 16 upgrades read at once, 2 s each. Then one task per direction passes messages unchanged and in order, and reads the next only when the write of the previous has completed, so Rust holds at most a 256 KiB or 64-message write batch and one message per direction (a peak counter records it); each leg answers its own pings and none is passed on; a close frame passes with its code and reason (2 s for the answer); a leg that ends without one drops the page's leg (the page sees 1006) or closes the daemon's with 1001; a message above 128 MiB closes both legs with 1009. A `Proxies` set holds at most four connections (`reserve` before the dial, so a fifth is `limit` without a daemon being dialled; `Reservation::open` after it), closes them all (1001 to each daemon, page legs dropped) and gives the snapshot `ui.inspect` shows: state, frames and bytes each way, the peak held, and the last abnormal end (`page_refused`, `page_timeout`, `upstream_lost`, `too_large`) with its time. The crate has no log: the app gives the proxy a function for its lines, which never carry the token, the local address or anything a peer sent. Tested against local servers, with hostile input, without Tauri. Above `shell` on purpose, so `engine` and `shell` cannot depend on it, and the layer check lets no UI crate (tauri, wry, tao) into it; only an app binary may use it. Empty on wasm32, where it has no dependency |
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
   in — `confirm`, `alert`, `open_url` and `pick_save_path`, built from the dialog and opener
   plug-ins in `src-tauri/src/services.rs`, and for the CLI `run` (a process with a time limit),
   `is_executable`, `env`, `home_dir` and `list_dir`, built from `shell::process`. The shell and
   the engine never call the OS themselves;
   the shell checks first (`links::check`: http, https and mailto only, at most 8,192 characters;
   `dialogs::cap_text`: 8,192 characters). Hooks may block, so the page's commands run them on the
   blocking pool, never on the owner or main thread. Where a hook is missing, the feature that
   needs it is disabled.
5. **The view and the control protocol** (`crates/shell/src/state.rs`, `control.rs`): all UI state
   is one serde struct, and `control::view` is the single value `ui.inspect` returns: UI state,
   the settings, the daemon list (views only, no secret), `connection: { secretStore, resumeSignals }` and the menu model. Four JSON methods
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
| `connect-src` | `ws:`, `wss:`, `blob:`, `ipc:`, `http://ipc.localhost` | The daemon and the relay, at an address the user types; reading opened files back (`fetch` of a `blob:` URL); Tauri's own channel |
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
listens for two events: `daemons_changed` (the registry view, sent after any request that changed
the registry, the local daemon state or a setting) and `connection_resume` (`{ reason }`, § Resume
signals). Tauri cannot scope `core:event:allow-listen` to names, so the page could listen to any
event; the app emits only `daemons_changed`, `daemons_manage` and `connection_resume`:

| Command | Does |
|---|---|
| `boot()` | Returns `{app: {title, version, platform: "desktop", minDaemonVersion}, storage, notices, preview, daemons}`: the stored workbench keys of both scopes merged, the notices (a file that could not be read and was reset, `file_reset`, with `keptAs` `null` when even the rename failed; a version 1 registry's secrets the store would not take, `secrets_not_moved`; or the keychain not being used at launch, `secret_store_fallback` with `reason` `unavailable`, `denied` or `failed`) — each returned once — the preview kind, and the registry view (`currentId`, entries, local state, settings, `secretStore`: `keychain`, `file` or `memory`; no secret). Resets the transfer count and clears the preview store |
| `storage_set(key, value)` | Queues one stored key. It is a synchronous command, so calls are applied in the order the page made them; it answers once queued. Size caps are checked on the owner thread and a refused write is logged with the key only |
| `dialog_confirm(message)` → bool | Native OK/Cancel dialog over the window; the text is capped at 8,192 characters. Closing it, or a failure, answers `false` |
| `dialog_alert(message)` | Native message dialog, same cap |
| `open_external(url)` | Opens the URL with the system opener after `links::check`; a refused or failed open is logged (scheme only) and the page is not told |
| `save_begin(suggestedName)` → `{handle}` \| null | Native save dialog starting in the last folder used this run, else Downloads. The name is reduced to a file name (no path parts, no control characters, at most 255 bytes). Creates `.pistudio-save-<hex>.part` beside the destination, listed in `pending-saves.json`. `null` when cancelled; at most 8 open |
| `save_write(bytes)` | Appends a raw body (at most 16 MiB) to the save named by the `handle` request header |
| `save_finish(handle)` / `save_discard(handle)` | Sync and rename over the destination / remove the temporary file. A handle is single use; errors never contain a path |
| `transfers_set(count)` | The page's count of uploads and saves in flight. Closing the window while it is above zero asks first ("N file transfer(s) are still running. Quit anyway?") |
| `preview_mount(html)` → `{url}` | Mounts an HTML document at the preview origin. An error on an `inert` platform or past the caps; the error never contains the document |
| `preview_release(url)` | Drops a mounted document; an unknown URL is ignored |
| `engine_command(id, params?)` | Runs one of ten allowed engine ids (`daemon.list/add/update/remove`, `daemon.local.*`, settings); anything else, including `daemon.switch` and `command.list`, is refused |
| `daemon_resolve_current()` | What to dial for the current entry: `{url, password?, connect: true}` or an error code. Starts a stopped local daemon when auto-start is on. The only command that returns a secret |
| `daemon_switch(id)` | Switches the current entry: unknown id → `not_found`; transfers running → native confirm ("N file transfer(s) are still running. Switch anyway?", "no" answers `cancelled`); then `daemon.switch` (flushes the entry left, records `lastUsedId`) and reloads the page. From the switch until the next `boot`, `storage_set` is dropped: the page being left writes its layout as it unloads, and that write would otherwise replace the new entry's. The native menu uses the same path |

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

**The registry** is `daemons.json`, version 2: the entries (`local`, `direct` with an address,
`relay`; `hasPassword` on `local` and `direct`) and `lastUsedId`. No secret is in it. The rules and
caps are in `crates/model/src/registry.rs` (a name of 1–64 characters, unique without regard to
case; an address at most 2,048, a password 1,024 and a pairing link 4,096 characters; at most 64
entries). The file is written with `store::write_private`: the temporary file is created at mode
0600 on Unix, so it is never readable by others, and a `*.corrupt-*` copy keeps that mode. Views
(`EntryView`) carry `hasPassword`, never a secret.

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
(`cli_find.rs`). A CLI older than 0.0.119 is `cli_outdated` and runs no daemon command. Each
call has its own limit (`--version` and `status` 5 s, `start` and `restart` 90 s, `stop` 15 s), a
timed-out process group is killed, and the answer is the last non-empty line of standard output
read as JSON whatever the exit code. The CLI's `pairingUrl` is discarded where the line is parsed.
Quitting the app never stops the daemon. On Windows none of this runs (`unsupported`).

**The native menu.** `menus::daemons_menu` turns the registry view into the "Daemons" menu (one
check item per entry, "Manage Daemons…", Start, Stop and Restart); `src-tauri/src/menu.rs` draws
it and rebuilds it after every `daemons_changed` on the main thread, and on macOS keeps the
standard App, Edit and Window menus. `ui.inspect` returns the same model. A click on the current
entry does nothing (Rust cannot see the page's connection); on another entry it runs the same
switch as the page (`daemon_switch`); Stop asks first when the current entry is the local one;
"Manage Daemons…" brings the window forward and emits `daemons_manage`. The native items have no
tooltips, so a disabled item's reason is only in the model.

**Secrets.** A direct (or local) entry's password and a relay entry's pairing link are not in
`daemons.json` (version 2: the entry says `hasPassword`); they are in the secret store the session
was given (`crates/secrets`). A version 1 file, which held them, is migrated when the session
opens (§ Decisions). They are never logged, never in a control answer, in `boot` or in
`ui.inspect`, and travel to the page once, in the answer of `daemon_resolve_current`, for the entry
being opened (the page sends them to Rust in `daemon.add` and `daemon.update`, and never gets them
back). A dial that finds the item gone from the store answers `secret_missing`; one that cannot
read the store answers `secret_unavailable`. A test (`crates/shell/tests/secret_guard.rs`) opens
on a version 1 file, runs commands and the supervisor against marker secrets, scans every answer
and log line, and checks that the file holds none. Removing an entry removes its secrets from the
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
- A ticker thread (`src-tauri/src/resume.rs`) wakes every 2 s, reads the wall and a steady clock and
  emits `connection_resume`; a watcher thread (`src-tauri/src/network.rs`) reads the interface
  addresses every 5 s and emits it too. Both end with the app (§ Resume signals).

## What stays out of the core

The engine and everything below it contain no tauri, wry or tao types; no window handles or file
dialogs; no `std::fs` outside `cfg(not(target_arch = "wasm32"))`; and no global mutable state. The
shell crate holds to the same rules. Sockets live in `net` only, only an app binary may use it, and `net` itself may use no tauri, wry or tao (the layer check enforces both).

## Decisions

Record design decisions here as they are made (which files, where the state
lives, what runs off the owner thread, which windows exist).

| Decision | Choice | Why |
|---|---|---|
| Where the UI and its state live | In the workbench, in TypeScript | One UI for the browser and the desktop; the limits that motivate this app are in the browser sandbox, not in the components (`docs/desktop-client-handoff.md` at the repository root) |
| How the frontend gets the workbench | From source, through Vite aliases to `packages/*/src`, as `packages/web-client` does | A workbench change shows up without building it, and `vite build` needs no package's `dist` |
| Which host the window uses | The desktop host: the browser host with storage, dialogs, links, save-to-disk, preview and the registry replaced by Rust-backed members; the transport, timers, upload and view URLs stay the browser host's for now. Outside Tauri, the plain browser host | Rust replaces host members one at a time; the snapshot tool and a dev-server browser have no Rust to ask |
| Local daemon | Supervise an installed `pi-studio` CLI (`pi-studio --json daemon start\|stop\|restart`); no bundled daemon for now | Cheap, and reuses the CLI's lifecycle code. Bundling Node is deferred until the app ships to people without Node; Windows has no local daemon (POSIX-only) and connects to remote or WSL2 daemons |
| Where a secret-store call runs | The session never calls the store on the thread that owns it, except at launch. A read is split in two: the session's `plan_dial` (pure, on the owner thread) answers with a `DialPlan` that names the item (`Password { url, entry }`, `PairingLink { entry }`) or is already final, and the caller finishes it (`DialPlan::finish(&dyn SecretStore)`) on its own thread: the supervisor's `OwnerAccess` holds the session's `Arc<dyn SecretStore>` (`Session::secret_store()`). Migration of a version 1 `daemons.json` runs once in `Session::with_config_dir`, before the owner thread has answered anything. `daemon.add`, `daemon.update` and `daemon.remove` are split the same way into a `SecretJob`: `Session::plan_secret_command` (pure, validates, builds the job), `SecretJob::store` (the calls that come before the file: set a secret, delete a cleared password; caller's thread), `Session::commit_secret_job` (planned again against the registry as it is then, written; under the lock) and `SecretJob::finish` (the calls after it: a removed entry's items, or taking back an added entry's secret when the file would not write; caller's thread). The owner loop (`shell/src/deferred.rs`) runs the store steps on worker threads and answers the asker when the job is done, so the page, the control socket and `OwnerAccess` need no change; `execute_unlocked(&Mutex<Session>, ..)` does the same for the CLI. `Session::execute` still runs the steps in a row (blocking) for a caller that owns its thread. A delete that fails on remove is logged with the entry id and the store's code, and the answer carries `notices: [{kind: "secret_not_removed", entry}]`; the entry is removed all the same | A keychain call can block on a system prompt, and the owner thread must keep answering storage writes, the control socket and dialogs meanwhile. A plan that names the item keeps the engine free of a thread or a hook it would have to wait on, and the owner never waits: a store that blocks 3 s holds up nothing, and an `add`/`update`/`remove` against a slow store answers other requests meanwhile (`owner_access.rs` tests). Committing against the registry as it is then, not as it was planned, keeps two commands that overlap from overwriting each other's file write; the owner loop polls every 20 ms only while a store step is outstanding, and at quit waits up to 30 s for those |
| A migration the store refuses | The version 1 file is left byte for byte as it was, this run serves its secrets from memory, and one `secrets_not_moved` notice is returned. While they are held, `daemon.add`, `.update` and `.remove` answer `secret_store_failed` and a switch does not rewrite the file | A version 2 file would claim secrets that only this run has: writing it would lose them when the app closes. The next launch tries again |
| Which secret store a launch uses | `--secret-store keychain\|file`, else the keychain when it can be used, else `secrets.json` in the configuration directory (`shell/src/secret_choice.rs`, shared by the app and its CLI). "Can be used" is a check on a thread of its own, within 2 s in all: the platform store is opened and a missing item read (`KeychainStore::probe`), then a throwaway item (fixed name, deleted at once, also when the launch has stopped waiting) is written and deleted. A refusal, no answer or a failure means the file, with a `secret_store_fallback` notice that names the code (`unavailable`, `denied`, `failed`); `--secret-store keychain` fails the launch instead, naming the option; `file` never touches the keychain. The check starts before the window is built (the keychain's scope depends on the arguments alone) and is collected after the configuration directory is known (the file store needs it); no session opens a directory before that. The kind chosen is `secretStore` in the registry view (`boot`, `daemons_changed`) and in `ui.inspect` (`connection.secretStore`) | The read alone passes on a Secret Service whose default collection is locked or absent, and the first real `set` would then fail with `denied`: only a write finds that out. A prompt (macOS) must not hold up the window, so the wait is bounded and the window opens on the file. Scratch runs pass `file` so that no check writes to a person's keychain |
| A store job still waiting at quit | The owner loop waits up to 30 s (`deferred::DRAIN`) for an outstanding `daemon.add`, `.update` or `.remove` store step, then ends without it: the job is dropped and its entry is not written. A secret the step had already stored may stay in the store with no entry (nothing removes it later) | A keychain call that waits on a prompt must not keep a quitting app alive for ever. The loss is at most one orphan item, never a secret in a file or a log |
