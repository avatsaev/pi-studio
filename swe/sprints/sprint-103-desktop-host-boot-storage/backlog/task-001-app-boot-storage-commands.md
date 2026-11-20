# Task 001 — App: session on real files, `boot` and `storage_set`, and the page's command list

- **Sprint:** sprint-103-desktop-host-boot-storage
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src-tauri (+ desktop/crates/shell)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-102/task-004

## Goal
The running app keeps its settings and the workbench's stored keys in its configuration directory, and the page can ask for one boot snapshot and send storage writes. Those are the only two things the page may call.

## Context / why
Today the page reaches Rust through two sample commands (`control`, `invoke_command`) and a `view` event that nothing uses any more. The desktop host needs a snapshot before the workbench first renders (its storage is read synchronously) and a cheap way to hand each write to Rust.

## Scope references
- `swe/features/desktop-native-host.md` § Public contract 1 (boot snapshot), § Storage, § Public contract 5 (rows "Tauri commands for the page", "Events"), § Public contract 6 (capabilities), § Error handling (storage rows)
- `desktop/apps/pistudiodesktop/src-tauri/src/` (`main.rs`, `bridge.rs`, `commands.rs`, `control_server.rs`), `build.rs`, `capabilities/default.json`, `Cargo.toml`
- `desktop/crates/shell/src/control.rs` (`Request`, `Envelope`), `desktop/crates/engine` (`Session` open, storage API, flush: sprint-102/task-003)
- `desktop/docs/architecture.md` § The webview boundary, `desktop/AGENTS.md` golden rule 6

## What to build
- **Configuration directory:** the platform's per-user configuration directory for the app identifier. `--config-dir <DIR>` (and `PISTUDIODESKTOP_CONFIG_DIR`) overrides it, for tests and live checks. The thread that owns the session opens it there.
- **Page commands** (replace `control` and `invoke_command`; remove the `view` event):
  | Command | Input | Answer |
  |---|---|---|
  | `boot` | none | `{ app: { title, version, platform: "desktop" }, storage: { [key]: string }, notices: [{ kind: "file_reset", file, keptAs }] }` |
  | `storage_set` | `{ key, value }` | nothing; answers once the write is queued, not once it is on disk |
  `boot` also clears the notices it returned, so a page reload does not show them twice. Key and value are checked against the model's caps in Rust.
- All session access stays on the one owner thread; the control socket keeps working through the same channel.
- **Flush:** the changed scope's file is written within 1 s of the first unwritten change (later changes inside that second ride along), and everything unwritten is written before the process exits (bounded wait, 5 s).
- **Command list:** declare the app's commands in the build script so that only listed commands can be invoked, and allow exactly `boot` and `storage_set` in `capabilities/default.json`. Reduce `core:default` to what the page uses.

## Out of scope
- `daemons`, `minDaemonVersion` and `preview` in the snapshot (registry plan; sprint-105/task-003).
- Window configuration and single instance (task-002). The frontend (task-003).

## Acceptance criteria
- [ ] With `--config-dir <tmp>`, a `storage_set` of `pi-studio-pane-layout` is in `<tmp>/daemon-state/local.json` within about a second, and `pi-studio-appearance` is in `<tmp>/settings.json`.
- [ ] Twenty writes of one key inside a second cause one file write.
- [ ] Quitting right after a write still leaves the value on disk.
- [ ] `boot` returns the stored keys of both scopes merged, and the notice for a file that was reset exactly once.
- [ ] A value over 4 MiB or a 300-byte key is refused without touching the file.
- [ ] `control`, `invoke_command` and the `view` event are gone from the app; the control socket still answers `ui.inspect`.
- [ ] Invoking a command that is not listed (for example a dialog plug-in command) from the page is rejected.

## Test / verification plan
- Unit tests for the flush timing decision with an injected clock, where it lives (`cargo test -p pistudiodesktop-shell` or `-p pistudiodesktop-engine`).
- `cargo xtask web && cargo xtask ci` in `desktop/`.
- Control socket smoke: start the app with `--control 0 --config-dir <tmp>` in the WebDriver container (`desktop/docs/development.md`), call `settings.set`, check the file.
- The page-side checks run in task-004.

## Notes
- How Tauri 2 restricts app commands (an app manifest in the build script, then `allow-<command>` permissions) is from its documentation and was not tried here: confirm it, and that an unlisted command is really refused.
- The app has no user yet: nothing migrates from the webview's storage.
- Log lines name keys, never values.
