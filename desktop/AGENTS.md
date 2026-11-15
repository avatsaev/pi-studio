# AGENTS.md

Pi Studio is a native desktop app: a headless Rust engine, and a Tauri window whose webview
(React + TypeScript) draws what the engine publishes. Read `docs/architecture.md` next.

This directory is the Cargo workspace root, inside the pi-studio monorepo: every path and command
in this file is relative to `desktop/`. The frontend (`apps/pistudiodesktop`) is an npm workspace
of the repository root, so its dependencies are in the root `package-lock.json`: install them with
`npm ci` at the repository root, never here.

If the `av-rust-desktop-*` agent skills are installed, use them: `av-rust-desktop-develop` for
everyday changes, `av-rust-desktop-architecture` for the rules in depth.

## Workspace map

    crates/doc              L1  the model: pure data
    crates/ops              L2  history
    crates/format           L3  native file format
    crates/engine           L5  Session + command registry (every action is a command)
    crates/shell            L6  UI state, generated menus, control protocol (no UI toolkit)
    crates/testkit              test helpers
    apps/pistudiodesktop                  the web frontend: React + TypeScript, thin
    apps/pistudiodesktop/src-tauri        the desktop binary: Tauri window, dialogs, control server
    apps/pistudiodesktop-cli              headless CLI
    xtask/                      cargo xtask layers | web | wasm | test | ci

Layering is enforced by `cargo xtask layers`. Register a new crate in `xtask/src/layers.rs`.

## Golden rules

1. The core is Rust. Web technology lives only in the frontend (`apps/pistudiodesktop/src`), and the
   frontend is thin: it draws the view it is sent and sends command ids. No business logic, no
   document state and no file or network access in TypeScript.
2. Never crash. Non-test Rust code has no unwrap, expect or panic, and no unsafe. Return errors.
   Input is hostile: check bounds, cap sizes, bound recursion. A crash fix ships with a test that
   panicked before it.
3. Everything is a command. User-visible behaviour is a command in
   `crates/engine/src/*_cmds.rs` with id, label, menu, shortcut, params doc, `enabled`, `run` and
   tests. The frontend, the CLI and the control channel dispatch ids.
4. A crate depends only on lower layers. Nothing below the app binary uses tauri, wry or tao.
5. UI state is data. What automation should see lives in `crates/shell/src/state.rs`; the frontend
   keeps only what a widget needs while it is on screen. Colours come from the tokens in
   `apps/pistudiodesktop/src/tokens.css`. Look at a rendered image (`npm run snapshot`) before calling a UI
   change done.
6. The webview gets the least it needs. It may call the app's two commands and listen for one
   event; no plug-in permissions, a strict CSP, no remote content in the main window.
7. Never break wasm. File-system code is `cfg(not(target_arch = "wasm32"))` or behind `Services`.
8. Tests are the gate. Every change comes with tests.
9. Permissive licences only, for crates and npm packages alike. Check a dependency's licence
   before adding it; record every bundled asset in `ATTRIBUTION.md`.

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
