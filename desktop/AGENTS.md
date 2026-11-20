# AGENTS.md

Pi Studio Desktop is the native client for a Pi-Studio daemon: a Tauri window whose webview runs
the workbench (`@av-pi-studio/workbench`, the same UI as the browser client), and a Rust side for
what a browser does badly: sockets, files on disk, secrets and OS integration. Read
`docs/architecture.md` next.

**Where it stands.** The window draws the workbench with a desktop host: at start the page calls
`boot`, which returns the stored workbench keys from the configuration directory, and every
storage write goes back through `storage_set` to the Rust engine, which writes the files. The
webview still opens the WebSocket to the daemon itself. The engine's settings (`settings.get`,
`settings.set`) sit behind a command registry that the CLI and the control socket dispatch into.
Moving the remaining host members into Rust, one at a time, comes next.

This directory is the Cargo workspace root, inside the pi-studio monorepo: every path and command
in this file is relative to `desktop/`. The frontend (`apps/pistudiodesktop`) is an npm workspace
of the repository root, so its dependencies are in the root `package-lock.json`: install them with
`npm ci` at the repository root, never here.

If the `av-rust-desktop-*` agent skills are installed, use them: `av-rust-desktop-develop` for
everyday changes, `av-rust-desktop-architecture` for the rules in depth.

## Workspace map

    crates/model            L1  the settings and one daemon entry's stored state: pure data
    crates/store            L3  JSON files: safe reads, atomic writes
    crates/engine           L5  Session + command registry (every action is a command)
    crates/shell            L6  UI state, generated menus, control protocol (no UI toolkit)
    crates/testkit              test helpers
    apps/pistudiodesktop                  the web frontend: a shell that mounts the workbench
    apps/pistudiodesktop/src-tauri        the desktop binary: Tauri window, dialogs, control server
    apps/pistudiodesktop-cli              headless CLI
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
   manifest lists and the capability grants (`boot`, `storage_set`); no `core:` or plug-in
   permissions, no remote content in the main window, navigation only within the app origin, and a
   Content-Security-Policy that lists exactly the sources the workbench uses (`app.security.csp`
   in `tauri.conf.json`). Add a source or a command only with the feature that needs it;
   `npm run snapshot` fails when the page breaks the policy.
7. Never break wasm. File-system code is `cfg(not(target_arch = "wasm32"))` or behind `Services`;
   `store` is empty on wasm32.
8. Tests are the gate. Every change comes with tests.
9. Permissive licences only, for crates and npm packages alike. Check a dependency's licence
   before adding it; record every bundled asset in `ATTRIBUTION.md`. Known exception, not yet
   decided: the workbench and `@av-pi-studio/ui-library` are AGPL-3.0 and are bundled into the app.

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
