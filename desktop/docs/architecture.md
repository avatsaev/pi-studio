# Architecture

A Tauri window whose webview runs the workbench (`@av-pi-studio/workbench`, the UI shared with the
browser client), and a Rust workspace in enforced layers with all platform code at the edge.

Two halves, joined today by nothing:

- **The window.** `apps/pistudiodesktop/src` mounts the workbench and gives it a host
  (`WorkbenchHost`, `packages/workbench/README.md`). The host is the workbench's browser host: the
  webview opens the WebSocket to the daemon itself and keeps settings in its own storage. Rust
  takes over one host member at a time (transport, file transfer, dialogs, secrets).
- **The Rust workspace.** Still the template's sample: a headless engine in which every action is
  a command over immutable snapshots of a data model (a checklist), and a shell that turns its
  state into one value. The window no longer draws that value; the CLI and the control socket
  still reach the engine. Everything below "Layers" describes this half until it is replaced.

## Layers

A crate may depend only on crates in lower layers. Nothing below the app binary may use a UI
toolkit, a webview or a windowing crate (tauri, wry, tao, muda, rfd). `cargo xtask layers` checks
both on every run of the gate; the table it checks is `TABLE` in `xtask/src/layers.rs`, and a crate
missing from it fails the gate.

| Layer | Crates | What belongs here |
|---|---|---|
| L0 | none yet | Types with no domain model (geometry, units, colour, storage containers), and standalone crates that parse or encode a foreign format and depend on no workspace crate |
| L1 | `doc` | The model: plain serde data and the invariants that keep it valid |
| L2 | `ops` | History, and domain algorithms written as pure functions over L0 and L1 data |
| L3 | `format` | The native file format, storage, renderers |
| L4 | none yet | Mapping the model to and from foreign formats; a plug-in host |
| L5 | `engine` | `Session` and the command registry: the façade every frontend talks to |
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
3. **Immutable snapshots.** The current state is an `Arc<Document>`. `Session::edit(label, f)`
   clones it, lets the command change the copy, and publishes the copy with one history step only
   when the command returned `Ok`. A failed or panicking command leaves the state untouched; undo
   and redo swap pointers; readers hold a snapshot without a lock.
4. **`Services`** (`crates/shell/src/services.rs`): optional function hooks the app binary fills
   in. The shell and the engine never call the OS themselves. Where a hook is missing, the feature
   that needs it is disabled.
5. **The view and the control protocol** (`crates/shell/src/state.rs`, `control.rs`): all UI state
   is one serde struct, and `control::view` is the single value the frontend draws: UI state,
   document and menu bar. Four JSON methods expose the running app (`docs/control-protocol.md`),
   and the webview uses the same four.

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

Known gap: the HTML file preview draws the page but its scripts do not run. The preview is a
sandboxed `srcdoc` frame, which inherits this policy, and `script-src` has no `'unsafe-inline'`.
In the browser client, which has no policy, they run. Fixing it needs the preview served from an
origin of its own, not a weaker policy for the main window.

The app still registers two Tauri commands and one event for the sample engine
(`apps/pistudiodesktop/src-tauri/src/commands.rs`, `bridge.rs`); the frontend calls neither:

| | Does |
|---|---|
| `control(method, params)` | A control-protocol call: `engine.execute`, `engine.commands`, `ui.inspect`, `ui.set` |
| `invoke_command(command)` | A menu click or a shortcut: the shell collects what the command needs (a file dialog) and runs it |
| event `view` | The sample's view, sent whenever it changed |

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

Record design decisions here as they are made (is there a file, is there undo, where the state
lives, what runs off the owner thread, which windows exist).

| Decision | Choice | Why |
|---|---|---|
| Where the UI and its state live | In the workbench, in TypeScript | One UI for the browser and the desktop; the limits that motivate this app are in the browser sandbox, not in the components (`docs/desktop-client-handoff.md` at the repository root) |
| How the frontend gets the workbench | From source, through Vite aliases to `packages/*/src`, as `packages/web-client` does | A workbench change shows up without building it, and `vite build` needs no package's `dist` |
| Which host the window uses | The workbench's browser host, for now | Proves packaging and the policy first; Rust replaces host members one at a time |
| Local daemon | Supervise an installed `pi-studio` CLI (`pi-studio --json daemon start\|stop\|restart`); no bundled daemon for now | Cheap, and reuses the CLI's lifecycle code. Bundling Node is deferred until the app ships to people without Node; Windows has no local daemon (POSIX-only) and connects to remote or WSL2 daemons |
