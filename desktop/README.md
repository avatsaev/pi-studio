# Pi Studio

Pi Studio Desktop is the native client for a Pi-Studio daemon: a [Tauri](https://tauri.app) window
whose webview runs the workbench (`@av-pi-studio/workbench`, the same UI as the browser client),
and a Rust side for what a browser does badly: sockets, files on disk, secrets and OS integration.

Today the window draws the workbench and connects to a daemon with the webview's own WebSocket.
The Rust crates still hold the starter sample (a checklist engine with undo, a file format, menus
and a control channel), which the window no longer draws; the CLI and the control socket still
reach it. Replacing it, and moving the sockets into Rust, comes next.

## Build and run

Prerequisites are listed in [docs/development.md](docs/development.md).

```sh
(cd .. && npm ci)                       # once, at the repository root: the frontend is an npm workspace of it
cargo xtask ci                          # the gate: fmt, frontend, clippy, layering, tests, command fuzz, doctests, wasm check
cargo run -p pistudiodesktop                      # the window: type a daemon address (127.0.0.1:6767) and connect
cargo run -q -p pistudiodesktop-cli -- commands   # every command the app has, as JSON lines
```

While working on the frontend, `npm run app` in `apps/pistudiodesktop` starts the window on Vite's dev server
with hot reload. `npm run bundle` builds installers.

## Where things are

| Path | What |
|---|---|
| `crates/doc` | L1: the model, pure data |
| `crates/ops` | L2: history (undo and redo over snapshots) |
| `crates/format` | L3: the native file format |
| `crates/engine` | L5: `Session` and the command registry |
| `crates/shell` | L6: UI state, the generated menu bar and the control protocol, with no UI toolkit in it |
| `crates/testkit` | Test helpers |
| `apps/pistudiodesktop` | The desktop app's web frontend: a shell that mounts the workbench and gives it a host |
| `apps/pistudiodesktop/src-tauri` | The desktop app's Rust binary: the Tauri window, file dialogs, the control server |
| `apps/pistudiodesktop-cli` | The headless CLI |
| `xtask` | `cargo xtask layers \| web \| wasm \| test \| ci` |

Read [AGENTS.md](AGENTS.md) for the rules and [docs/architecture.md](docs/architecture.md) for the
design.

## Licence

Licensed under either of the [Apache License, Version 2.0](LICENSE-APACHE) or the
[MIT licence](LICENSE-MIT), at your option. Bundled third-party assets are listed in
[ATTRIBUTION.md](ATTRIBUTION.md).
