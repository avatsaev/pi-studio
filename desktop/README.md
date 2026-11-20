# Pi Studio

Pi Studio Desktop is the native client for a Pi-Studio daemon: a [Tauri](https://tauri.app) window
whose webview runs the workbench (`@av-pi-studio/workbench`, the same UI as the browser client),
and a Rust side for what a browser does badly: sockets, files on disk, secrets and OS integration.

The window draws the workbench with a desktop host: settings, per-daemon layouts, dialogs, links,
saving files and the HTML preview go through Rust, and a daemon registry (this machine, a direct
address, a relay pairing link) opens on the daemon used last and starts this machine's daemon
through the installed `pi-studio` CLI. The webview still opens the WebSocket to the daemon itself;
sockets, large-file transfer and secrets in the OS keychain are later milestones. Built and
checked on Linux; macOS and Windows have not run (see [docs/platform-checks.md](docs/platform-checks.md)).
Behind the window, the Rust crates hold an engine with the registry, the settings and the stored
workbench state, a command registry (every action is a command), generated menus and a control
channel; the page, the CLI and the control socket reach it.

## Build and run

Prerequisites are listed in [docs/development.md](docs/development.md).

```sh
(cd .. && npm ci)                       # once, at the repository root: the frontend is an npm workspace of it
cargo xtask ci                          # the gate: fmt, frontend, clippy, layering, tests, command fuzz, doctests, wasm check
cargo run -p pistudiodesktop                      # the window: opens on the local daemon (started through the CLI if needed)
cargo run -q -p pistudiodesktop-cli -- commands   # every command the app has, as JSON lines
```

While working on the frontend, `npm run app` in `apps/pistudiodesktop` starts the window on Vite's dev server
with hot reload. `npm run bundle` builds installers.

## Where things are

| Path | What |
|---|---|
| `crates/model` | L1: the settings, the daemon registry and one entry's stored state, pure data |
| `crates/store` | L3: JSON files, read safely and written atomically |
| `crates/engine` | L5: `Session`, the command registry, the registry, the settings and the stored workbench keys |
| `crates/shell` | L6: UI state, the generated menu bar (with the Daemons menu), the control protocol, the page's commands and the local-daemon supervisor, with no UI toolkit in it |
| `crates/testkit` | Test helpers |
| `apps/pistudiodesktop` | The desktop app's web frontend: a shell that mounts the workbench and gives it a host |
| `apps/pistudiodesktop/src-tauri` | The desktop app's Rust binary: the Tauri window, dialogs, the control server |
| `apps/pistudiodesktop-cli` | The headless CLI |
| `xtask` | `cargo xtask layers \| web \| wasm \| test \| ci` |

Read [AGENTS.md](AGENTS.md) for the rules and [docs/architecture.md](docs/architecture.md) for the
design.

## Licence

Licensed under either of the [Apache License, Version 2.0](LICENSE-APACHE) or the
[MIT licence](LICENSE-MIT), at your option. Bundled third-party assets are listed in
[ATTRIBUTION.md](ATTRIBUTION.md).
