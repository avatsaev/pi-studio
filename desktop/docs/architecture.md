# Architecture

A Tauri window whose webview runs the workbench (`@av-pi-studio/workbench`, the UI shared with the
browser client), and a Rust workspace in enforced layers with all platform code at the edge.

Two halves, joined today by nothing:

- **The window.** `apps/pistudiodesktop/src` mounts the workbench and gives it a host
  (`WorkbenchHost`, `packages/workbench/README.md`). The host is the workbench's browser host: the
  webview opens the WebSocket to the daemon itself and keeps settings in its own storage. Rust
  takes over one host member at a time (transport, file transfer, dialogs, secrets).
- **The Rust workspace.** A headless engine in which every action is a command, holding the
  settings and the workbench's stored keys, and a shell that turns its state into one value. The
  window does not draw that value; the CLI and the control socket reach the engine. Everything
  below "Layers" describes this half.

## Layers

A crate may depend only on crates in lower layers. Nothing below the app binary may use a UI
toolkit, a webview or a windowing crate (tauri, wry, tao, muda, rfd). `cargo xtask layers` checks
both on every run of the gate; the table it checks is `TABLE` in `xtask/src/layers.rs`, and a crate
missing from it fails the gate.

| Layer | Crates | What belongs here |
|---|---|---|
| L0 | none yet | Types with no domain model (geometry, units, colour, storage containers), and standalone crates that parse or encode a foreign format and depend on no workspace crate |
| L1 | `model` | The settings and one daemon entry's stored state, as plain serde data with the limits that keep them valid |
| L2 | none yet | Domain algorithms written as pure functions over L0 and L1 data |
| L3 | `store` | JSON files: read with a fallback when corrupt, written atomically. Knows no document type; empty on wasm32 |
| L4 | none yet | Mapping the model to and from foreign formats; a plug-in host |
| L5 | `engine` | `Session`, the command registry, the settings and the stored workbench keys: the façade every frontend talks to |
| L6 | `shell` | UI state, the menu bar generated from the registry, shortcuts, the control protocol. No UI toolkit: it produces the view as data |
| testkit | `testkit` | Test helpers; other crates use it as a dev-dependency only |
| apps | `pistudiodesktop` (`apps/pistudiodesktop/src-tauri`), `pistudiodesktop-cli` | Binaries: argument parsing, the Tauri window, file dialogs, sockets, OS integration |
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
3. **Storage.** `Session::with_config_dir(dir)` loads two files from one configuration directory,
   and `Session::new()` keeps everything in memory and writes nothing: `settings.json` (the
   settings and the global workbench keys) and `daemon-state/<entry id>.json` (the current daemon
   entry's workbench keys; the entry is `local` until the registry exists). A settings change is
   written before `settings.set` answers. The workbench's keys are opaque strings written often,
   so they are a plain API on `Session` (`storage_set`, `storage_snapshot`, `storage_flush`), not
   commands. A file that cannot be read is renamed aside and replaced by defaults, and the session
   returns a notice once. Logs name files, never their content.
4. **`Services`** (`crates/shell/src/services.rs`): optional function hooks the app binary fills
   in — `confirm`, `alert`, `open_url` and `pick_save_path`, built from the dialog and opener
   plug-ins in `src-tauri/src/services.rs`. The shell and the engine never call the OS themselves;
   the shell checks first (`links::check`: http, https and mailto only, at most 8,192 characters;
   `dialogs::cap_text`: 8,192 characters). Hooks may block, so the page's commands run them on the
   blocking pool, never on the owner or main thread. Where a hook is missing, the feature that
   needs it is disabled.
5. **The view and the control protocol** (`crates/shell/src/state.rs`, `control.rs`): all UI state
   is one serde struct, and `control::view` is the single value `ui.inspect` returns: UI state,
   the settings, the daemon list (views only, no secret) and the menu model. Four JSON methods
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
listens for one event, `daemons_changed` (the registry view, sent after any request that changed
the registry, the local daemon state or a setting). Tauri cannot scope `core:event:allow-listen` to
names, so the page could listen to any event; the app emits only `daemons_changed` and
`daemons_manage`:

| Command | Does |
|---|---|
| `boot()` | Returns `{app: {title, version, platform: "desktop", minDaemonVersion}, storage, notices, preview, daemons}`: the stored workbench keys of both scopes merged, the notices (a file that could not be read and was reset) — each returned once — the preview kind, and the registry view (`currentId`, entries, local state, settings; no secret). Resets the transfer count and clears the preview store |
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

## Threads

- One thread owns the `AppShell` and so the `Session`. Commands run there.
- The webview's commands and the control-socket threads only forward: each request crosses a
  channel to the owner thread, which answers them one at a time. A click and an automation request
  never race.
- Slow work belongs on a worker that computes from a snapshot and hands back a result the owner
  thread applies as one command.

## What stays out of the core

The engine and everything below it contain no tauri, wry or tao types; no sockets, window handles
or file dialogs; no `std::fs` outside `cfg(not(target_arch = "wasm32"))`; and no global mutable
state. The shell crate holds to the same rules.

## Decisions

Record design decisions here as they are made (which files, where the state
lives, what runs off the owner thread, which windows exist).

| Decision | Choice | Why |
|---|---|---|
| Where the UI and its state live | In the workbench, in TypeScript | One UI for the browser and the desktop; the limits that motivate this app are in the browser sandbox, not in the components (`docs/desktop-client-handoff.md` at the repository root) |
| How the frontend gets the workbench | From source, through Vite aliases to `packages/*/src`, as `packages/web-client` does | A workbench change shows up without building it, and `vite build` needs no package's `dist` |
| Which host the window uses | The workbench's browser host, for now | Proves packaging and the policy first; Rust replaces host members one at a time |
| Local daemon | Supervise an installed `pi-studio` CLI (`pi-studio --json daemon start\|stop\|restart`); no bundled daemon for now | Cheap, and reuses the CLI's lifecycle code. Bundling Node is deferred until the app ships to people without Node; Windows has no local daemon (POSIX-only) and connects to remote or WSL2 daemons |
