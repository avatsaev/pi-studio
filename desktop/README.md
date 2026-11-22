# Pi Studio

Pi Studio Desktop is the native client for a Pi-Studio daemon: a [Tauri](https://tauri.app) window
whose webview runs the workbench (`@av-pi-studio/workbench`, the same UI as the browser client),
and a Rust side for what a browser does badly: sockets, files on disk, secrets and OS integration.

The window draws the workbench with a desktop host: settings, per-daemon layouts, dialogs, links,
saving files and the HTML preview go through Rust, and a daemon registry (this machine, a direct
address, a relay pairing link, an SSH host) opens on the daemon used last and starts this machine's daemon
through the installed `pi-studio` CLI. Passwords, pairing links and SSH passwords and passphrases are kept in the operating
system's keychain when it answers, else in a file only the user can read, never in `daemons.json`.
The socket to the daemon of every entry is opened by Rust (the page asks `transport_open` and connects to
the loopback address it answers): a dial for a local or direct entry, the relay's encrypted channel for a relay entry
(the pairing link never reaches the page), and for an SSH entry a channel of an SSH connection to the host (`~/.ssh/config`,
jump hosts, agent, key files or a stored password; a host key it has not seen is confirmed in a native dialog and kept in
the app's own `known_hosts`) that needs no open daemon port; when the daemon is not running there, a Start button runs
`pi-studio daemon start` on the host. File uploads and saves for every entry run in Rust on a connection of their own: the Upload
button opens the platform's file dialog, up
to three transfers run at once and the rest wait, each shows a percentage and a Cancel button in the Files explorer,
and one that loses its connection continues by itself (`transfer_upload`, `transfer_save`,
`transfer_cancel` and the `transfer_progress` event; `--transfers page` turns that off, and a file
dropped on the window keeps the page's own path). Built and checked on Linux (the keychain too: a Secret Service, and the file
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
| `crates/model` | L1: the settings, the daemon registry (local, direct, relay and SSH entries; `daemons.json` version 3) and one entry's stored state, pure data; the address rule shared by vector with the workbench, and the pairing-link parser, whose vectors the SDK's test reads too |
| `crates/store` | L3: JSON files, read safely and written atomically |
| `crates/secrets` | L3: the secret store, with a keychain backend (macOS Keychain, Windows Credential Manager, the Secret Service), a file backend (`secrets.json`, mode 0600) and a memory backend |
| `crates/engine` | L5: `Session`, the command registry, the registry, the settings and the stored workbench keys |
| `crates/shell` | L6: UI state, the generated menu bar (with the Daemons menu), the control protocol, the page's commands and the local-daemon supervisor, with no UI toolkit in it |
| `crates/net` | L7: sockets, native only: the dial to a daemon (TCP, TLS trusting the operating system's store, the WebSocket upgrade with the bearer subprotocol; `dial_over` does the upgrade on a stream the caller opened, as an SSH channel), both answering a `DaemonSocket`, and the loopback proxy that answers a single-use local URL the page's own `WebSocket` connects to; used by `transfer`, `relay`, `ssh` and an app binary only |
| `crates/transfer` | L8: the transfer engine, native only (its limits, its error type, the wire code: the text and binary frames the daemon and the engine exchange, tested against the published fixtures, the bulk connection: the handshake, requests with answers, upload confirmations, downloads read no faster than their consumer takes them, liveness and the ways a connection ends, one save over that connection: a file on the daemon written into a sink from any offset, read no faster than the sink writes, stopped with a cancel that keeps the stream id reserved until the daemon is done with it, one upload over that connection, and the engine that drives them: uploads and saves resolved when they settle, at most three at once and the rest in order, the connection opened by the first and closed 30 s after the last, progress events (at most ten a second per transfer), cancel of one or of all, a snapshot of its state, and recovery: a dropped or unreachable daemon makes transfers wait and retry after 1 s doubling to 30 s without limit (a wake call ends the wait; a password, address, certificate, version, link, key or login error fails them at once), a save resumes from its bytes and an upload starts again from zero, and a stand-in daemon in the test's process, behind the `testing` feature, that serves and misbehaves on request, and the hardening tests: a drop and a cancel at every stage of an upload and a save, hostile frames, a seeded soak of three transfers at once with random faults, no secret or local path in anything the engine says, and counters past 4 GiB); its connector gives it a `DaemonSocket` from `net`, `relay` or `ssh`; used by an app binary only |
| `crates/relay` | L8: the relay client (protocol 2), native only: pairs through the relay, swaps keys with the daemon and answers an encrypted `DaemonSocket`; checked against the published relay fixtures; used by an app binary only |
| `crates/ssh` | L8: the SSH client, native only: `~/.ssh/config`, known hosts, login (agent, key files, password) through jump hosts, a channel to the daemon's port on the host, and remote commands; used by an app binary only |
| `crates/testkit` | Test helpers |
| `apps/pistudiodesktop` | The desktop app's web frontend: a shell that mounts the workbench and gives it a host |
| `apps/pistudiodesktop/src-tauri` | The desktop app's Rust binary: the Tauri window, dialogs, the control server, the proxied daemon connections and the file transfers (`transfer_upload`, `transfer_save`, `transfer_cancel`) |
| `apps/pistudiodesktop-cli` | The headless CLI |
| `apps/ipc-bench` | The IPC benchmark: a small Tauri app that measures the webview's WebSocket (the baseline), two candidate transport bridges (per-frame and batched) and a loopback WebSocket proxy owned by Rust on throughput, echo latency (alone and under a download), a hidden window and memory, and writes `results.json`. Never bundled or released |
| `xtask` | `cargo xtask layers \| web \| wasm \| test \| ci` |

Read [AGENTS.md](AGENTS.md) for the rules and [docs/architecture.md](docs/architecture.md) for the
design.

## Licence

Licensed under either of the [Apache License, Version 2.0](LICENSE-APACHE) or the
[MIT licence](LICENSE-MIT), at your option. Bundled third-party assets are listed in
[ATTRIBUTION.md](ATTRIBUTION.md).
