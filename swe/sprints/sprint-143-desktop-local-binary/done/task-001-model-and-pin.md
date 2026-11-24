# Task 001 — Desktop model: the pin, the new local states, no `cliPath`

- **Sprint:** sprints/sprint-143-desktop-local-binary
- **Status:** done
- **Type:** feature
- **Area:** desktop (model, apps)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-142/task-006, sprint-141/task-003

## Goal
`desktop/daemon-pin.json` (from the first published binaries) is compiled into the app and validated;
`LocalState` has the states of S10; `cliPath` is gone from the settings; a `--daemon-pin <file>`
launch option replaces the pin for checks.

## Scope references
- `swe/features/single-binary-daemon.md` § Public contract 4, S5, S10, S12
- `desktop/crates/model/src/registry.rs` (`LocalState`, `FailReason`), `desktop/crates/model/src/lib.rs` (`Settings`), `desktop/crates/engine/src/settings_cmds.rs`, `storage.rs`
- `desktop/apps/pistudiodesktop/src-tauri/src/main.rs` (launch options, like `--update-manifest`)
- Create: `desktop/daemon-pin.json` (written by `daemon-pin.mjs` from the published `latest.json`)

## What to build
- A `DaemonPin { version, assets: {target → {url, sha256, size}} }` type, parsed from the compiled-in
  file at build time or first use; an invalid file fails the build (a test reads the committed file).
- `LocalState`: remove `CliMissing`; `CliOutdated` → `Outdated { version }`; add `Downloading {
  received, total }`, `Installing`; `FailReason`: add `DownloadFailed`, `ChecksumMismatch`,
  `InstallFailed`; remove `UpdateFailed`.
- Settings: remove `cli_path` and the `cliPath` key (an old file's key is ignored).
- `--daemon-pin <file>`: debug launch option, logged without addresses, as `--update-manifest` is.
- Enable the pin step of `desktop-release.yml` (sprint-141/task-003's guard).

## Out of scope
Using the pin (task-003). The page (task-004).

## Acceptance criteria
- [ ] Model and engine tests for the new shapes; serde JSON forms pinned.
- [ ] `cd desktop && cargo fmt --all && cargo xtask ci` green (code that used the removed members is
      adjusted to compile; behaviour lands in task-003).

## Test / verification plan
- `cargo xtask ci`

## Notes
Removing members breaks `cli_find.rs` callers; keep the tree compiling with the smallest change and
leave the behaviour to task-003.
