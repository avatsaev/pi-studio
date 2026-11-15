# Pi Studio

Pi Studio is a native desktop app: a Rust engine in which every user action is a command, and a
[Tauri](https://tauri.app) window whose webview (React + TypeScript) draws the state the engine
publishes and sends command ids back. One engine serves every frontend: the desktop window, the
headless CLI, tests and automation.

This directory (`desktop/` in the pi-studio monorepo) currently holds the starter sample, a checklist with undo, a file format, menus,
shortcuts and a control channel. It shows every structural part of the app with no domain logic in
the way.

## Build and run

Prerequisites are listed in [docs/development.md](docs/development.md).

```sh
(cd .. && npm ci)                       # once, at the repository root: the frontend is an npm workspace of it
cargo xtask ci                          # the gate: fmt, frontend, clippy, layering, tests, command fuzz, doctests, wasm check
cargo run -p pistudiodesktop                      # the window
cargo run -p pistudiodesktop -- list.pistudiodesktop        # open a file
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
| `apps/pistudiodesktop` | The desktop app's web frontend (React + TypeScript): thin, it draws what the shell sends |
| `apps/pistudiodesktop/src-tauri` | The desktop app's Rust binary: the Tauri window, file dialogs, the control server |
| `apps/pistudiodesktop-cli` | The headless CLI |
| `xtask` | `cargo xtask layers \| web \| wasm \| test \| ci` |

Read [AGENTS.md](AGENTS.md) for the rules and [docs/architecture.md](docs/architecture.md) for the
design.

## Licence

Licensed under either of the [Apache License, Version 2.0](LICENSE-APACHE) or the
[MIT licence](LICENSE-MIT), at your option. Bundled third-party assets are listed in
[ATTRIBUTION.md](ATTRIBUTION.md).
