# Task 004 — Remove the checklist sample from the engine, the shell, the app and the CLI

- **Sprint:** sprint-102-desktop-rust-model
- **Status:** done
- **Type:** chore
- **Area:** desktop/crates (engine, shell, doc, ops, format), desktop/apps (src-tauri, pistudiodesktop-cli), desktop/xtask
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-003

## Goal
Nothing of the template's checklist is left: the three sample crates and every item, undo and file command are gone, and the engine, shell, app and CLI build and pass the gate on the new model alone.

## Context / why
D2: the checklist model, undo history and file format have no use in this app. The command registry, the control socket and the CLI stay. Every consumer of the document has to change in the same commit, or the tree does not build.

## Scope references
- `swe/features/desktop-native-host.md` § Public contract 5, § Removing the sample; grill D2
- `desktop/crates/engine/src/` (`session.rs`, `commands.rs`, `item_cmds.rs`, `edit_cmds.rs`, `file_cmds.rs`, `query_cmds.rs`, `error.rs`, `Cargo.toml`), `desktop/crates/engine/tests/panic_hunt.rs`
- `desktop/crates/shell/src/` (`lib.rs`, `state.rs`, `control.rs`, `menus.rs`, `services.rs`, `tests.rs`)
- `desktop/crates/doc`, `desktop/crates/ops`, `desktop/crates/format` (deleted)
- `desktop/apps/pistudiodesktop/src-tauri/src/` (`main.rs`, `bridge.rs`, `services.rs`, `Cargo.toml`), `desktop/apps/pistudiodesktop-cli/src/main.rs`
- `desktop/xtask/src/layers.rs`, `desktop/Cargo.toml`, `desktop/Cargo.lock`

## What to build
- **Engine:** delete the item, edit (undo/redo) and file command modules, `document.inspect`, `DocState` and everything on `Session` that exists for a document. Keep `Session::execute` with its panic guard, the registry, `command.list` and the settings commands. Drop the dependencies on the three crates.
- **Crates:** delete `doc`, `ops` and `format`, their workspace dependency lines and their rows in the layering table; update the table's layer comment.
- **Shell:** `UiState` keeps only `status` (the theme and "hide completed" belong to nobody now). `ui.set` stays in the protocol and accepts no field: `{}` succeeds, any field is an "unknown field" error. `ui.inspect` returns `{ ui, settings, menus }`. Remove the view-toggle shell commands, the file picker in `menus::invoke` and the `pick_file` service. The menu model stays generated from the registry; no command has a menu path for now.
- **App:** drop the `[file]` argument, the document opened at start, the native file picker and the dependency on the format crate. The control socket and its token handling are unchanged.
- **CLI:** `commands [--filter]` and `run --cmd '<id> [json]'...` remain; `info`, the file argument, `--new` and `--out` go. Add `run --config-dir <DIR>` to act on a configuration directory (in memory when omitted).
- The adversarial test's fixture is a plain new session.

## Out of scope
- The page's Tauri commands and the `view` event (sprint-103/task-001 replaces them).
- Documents (task-005).
- Any new command.

## Acceptance criteria
- [ ] `desktop/crates/` holds `engine`, `model`, `shell`, `store`, `testkit` and nothing else; no manifest names `doc`, `ops` or `format`.
- [ ] `command.list` returns exactly `command.list`, `settings.get` and `settings.set`.
- [ ] `ui.inspect` returns `ui.status`, the settings and an empty menu bar; `ui.set {"theme":"dark"}` is an error and `ui.set {}` succeeds.
- [ ] A command that panics is still reported as an error and the session keeps working (the existing guard test, rewritten on the new model).
- [ ] `pistudiodesktop-cli run --config-dir <tmp> --cmd 'settings.set {"key":"autoStartLocalDaemon","value":false}' --cmd settings.get` prints the changed setting and `<tmp>/settings.json` holds it.
- [ ] The app starts with no file argument and the control socket answers `engine.commands`.
- [ ] `cargo xtask ci` passes (all eight steps).

## Test / verification plan
- `cargo xtask web` first (the app embeds `dist/`), then `cargo xtask ci` in `desktop/`.
- `cargo run -p pistudiodesktop-cli -- commands`
- `rg -n "item\.|DocState|pistudiodesktop-(doc|ops|format)" desktop --glob '!target' --glob '!docs' --glob '!*.md'` finds nothing.

## Notes
- The frontend no longer listens for the `view` event or calls the two page commands; leave them compiling here, sprint-103/task-001 removes them.
- `Request::Invoke` (a menu click) stays: the registry plan's native menu uses it.
- Documents under `desktop/docs/` still describe the sample after this task; task-005 follows directly.
