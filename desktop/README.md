# Pi Studio

Pi Studio Desktop is the native client for a Pi-Studio daemon: a [Tauri](https://tauri.app) window
whose webview runs the workbench (`@av-pi-studio/workbench`, the same UI as the browser client),
and a Rust side for what a browser does badly: sockets, files on disk, secrets and OS integration.

The window draws the workbench with a desktop host: settings, per-daemon layouts, dialogs, links,
saving files and the HTML preview go through Rust, and a daemon registry (this machine, a direct
address, a relay pairing link) opens on the daemon used last and starts this machine's daemon
through the installed `pi-studio` CLI. Passwords and pairing links are kept in the operating
system's keychain when it answers, else in a file only the user can read, never in `daemons.json`.
The socket to a local or direct daemon is opened by Rust (the page asks `transport_open` and connects to
the loopback address it answers; a relay entry keeps the webview's own socket); large-file
transfer is a later milestone. Built and checked on Linux (the keychain too: a Secret Service, and the file
fallback); on macOS and Windows only the automated checks have run (see [docs/platform-checks.md](docs/platform-checks.md)).
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
| `crates/model` | L1: the settings, the daemon registry and one entry's stored state, pure data; the address rule shared by vector with the workbench |
| `crates/store` | L3: JSON files, read safely and written atomically |
| `crates/secrets` | L3: the secret store, with a keychain backend (macOS Keychain, Windows Credential Manager, the Secret Service), a file backend (`secrets.json`, mode 0600) and a memory backend |
| `crates/engine` | L5: `Session`, the command registry, the registry, the settings and the stored workbench keys |
| `crates/shell` | L6: UI state, the generated menu bar (with the Daemons menu), the control protocol, the page's commands and the local-daemon supervisor, with no UI toolkit in it |
| `crates/net` | L7: sockets, native only: the dial to a daemon (TCP, TLS trusting the operating system's store, the WebSocket upgrade with the bearer subprotocol) and the loopback proxy that answers a single-use local URL the page's own `WebSocket` connects to; used by `transfer` and an app binary only |
| `crates/transfer` | L8: the transfer engine, native only (so far its limits, its error type and the wire code: the text and binary frames the daemon and the engine exchange, tested against the published fixtures, and a stand-in daemon in the test's process, behind the `testing` feature, that serves and misbehaves on request); dials through `net`; used by an app binary only |
| `crates/testkit` | Test helpers |
| `apps/pistudiodesktop` | The desktop app's web frontend: a shell that mounts the workbench and gives it a host |
| `apps/pistudiodesktop/src-tauri` | The desktop app's Rust binary: the Tauri window, dialogs, the control server |
| `apps/pistudiodesktop-cli` | The headless CLI |
| `apps/ipc-bench` | The IPC benchmark: a small Tauri app that measures the webview's WebSocket (the baseline), two candidate transport bridges (per-frame and batched) and a loopback WebSocket proxy owned by Rust on throughput, echo latency (alone and under a download), a hidden window and memory, and writes `results.json`. Never bundled or released |
| `xtask` | `cargo xtask layers \| web \| wasm \| test \| ci` |

Read [AGENTS.md](AGENTS.md) for the rules and [docs/architecture.md](docs/architecture.md) for the
design.

## Licence

Licensed under either of the [Apache License, Version 2.0](LICENSE-APACHE) or the
[MIT licence](LICENSE-MIT), at your option. Bundled third-party assets are listed in
[ATTRIBUTION.md](ATTRIBUTION.md).
