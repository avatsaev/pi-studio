# AGENTS.md

Pi Studio Desktop is the native client for a Pi-Studio daemon: a Tauri window whose webview runs
the workbench (`@av-pi-studio/workbench`, the same UI as the browser client), and a Rust side for
what a browser does badly: sockets, files on disk, secrets and OS integration. Read
`docs/architecture.md` next.

**Where it stands.** Milestone 1 (the native host and the daemon registry) is built and checked
live on Linux; on macOS and Windows only the automated checks have run (GitHub runners, 2026-11-20:
`.github/workflows/desktop-platform-checks.yml`; `docs/platform-checks.md` lists them and what a person
still runs). The window draws the workbench with a desktop host: at start the page calls `boot` (the
stored workbench keys, the registry view, the preview kind), and every storage write goes back
through `storage_set` to the Rust engine, which writes the files in the configuration directory.
Confirm and alert dialogs, external links and save-to-disk are native, through Rust commands, and
the HTML preview is served from an origin of its own. The engine holds the daemon registry
(`daemons.json`, version 2, mode 0600, no secret in it; local, direct and relay entries; the secrets
are in a store the engine is given) and the settings; a supervisor runs
the installed `pi-studio` CLI to start, stop and restart this machine's daemon. The window opens on
the entry used last; a native Daemons menu and the workbench's switcher and Daemons screen switch,
add, edit and remove entries, each with its own stored layout. All of it sits behind a command
registry that the page, the CLI and the control socket dispatch into. The webview still opens the
WebSocket to the daemon itself (milestone 2 moves it into Rust, starting with an IPC benchmark).
Known gaps: a layout change in the last ~250 ms before the window closes is lost; the Upload
picker and a file dragged from the OS were not verified in the headless container.

This directory is the Cargo workspace root, inside the pi-studio monorepo: every path and command
in this file is relative to `desktop/`. The frontend (`apps/pistudiodesktop`) is an npm workspace
of the repository root, so its dependencies are in the root `package-lock.json`: install them with
`npm ci` at the repository root, never here.

If the `av-rust-desktop-*` agent skills are installed, use them: `av-rust-desktop-develop` for
everyday changes, `av-rust-desktop-architecture` for the rules in depth.

## Workspace map

    crates/model            L1  the settings, the daemon registry and one entry's stored state: pure data
    crates/store            L3  JSON files: safe reads, atomic writes
    crates/secrets          L3  the secret store: OS keychain (service `com.avatsaev.pi-studio`, one `keyring-core` store crate per platform by `cfg`; `KeychainStore::probe` answers within 2 s), file (`secrets.json`, 0600) and memory backends, and `FakeKeychain` (can block) for tests; no backend choice yet
    crates/engine           L5  Session + command registry (every action is a command)
    crates/shell            L6  UI state, generated menus (incl. the Daemons menu), control protocol, the page's commands, the local-daemon supervisor (no UI toolkit)
    crates/net              L7  the bridge's pure parts (frame batch codec, inbound window, outbound order buffer): no socket yet, no dependency, empty on wasm32; only an app binary may use it
    crates/testkit              test helpers
    apps/pistudiodesktop                  the web frontend: a shell that mounts the workbench
    apps/pistudiodesktop/src-tauri        the desktop binary: Tauri window, dialogs, control server
    apps/pistudiodesktop-cli              headless CLI
    apps/ipc-bench                        the IPC benchmark: baseline and two candidate bridges, B1-B8 incl. echo under load and a hidden window with a 2 s Rust tick (exempt from the layers; uses `net`; own page in page/, no npm package; never bundled or released; `docs/development.md` § The IPC benchmark)
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
   manifest lists and the capability grants (`docs/architecture.md` § The webview boundary); no
   plug-in permission and no `core:` permission except listening to events (Tauri cannot scope it
   to names), no remote content in the main window, navigation only within the app origin, and a
   Content-Security-Policy that lists exactly the sources the workbench uses (`app.security.csp`
   in `tauri.conf.json`). Add a source or a command only with the feature that needs it;
   `npm run snapshot` fails when the page breaks the policy.
7. Never break wasm. File-system code is `cfg(not(target_arch = "wasm32"))` (the engine reads and
   writes the app's files through the `store` crate, which is empty on wasm32) or behind
   `Services`.
8. Tests are the gate. Every change comes with tests.
9. Permissive licences only, for crates and npm packages alike. Check a dependency's licence
   before adding it; record every bundled asset in `ATTRIBUTION.md`. Known exception, not yet
   decided: the workbench and `@av-pi-studio/ui-library` are AGPL-3.0 and are bundled into the app.
10. Secrets (a direct entry's password, a relay entry's pairing link) live only in the secret store
    (`crates/secrets`), never in `daemons.json` (version 2: `hasPassword`); the CLI's `pairingUrl` is
    discarded. They are never logged, never in a control answer, in `boot` or in `ui.inspect`, and
    reach the page only through `daemon_resolve_current`, for the entry being opened. A store call
    may block: the session never makes one on the owner thread (it plans a dial, `DialPlan`, and the
    caller reads the store; `daemon.add/update/remove` are a `SecretJob` whose store steps run on
    worker threads, `deferred.rs`), except at launch, where a version 1 file's secrets are moved.
    A `*.corrupt-*` copy of the file keeps its mode and may hold old secrets.

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
