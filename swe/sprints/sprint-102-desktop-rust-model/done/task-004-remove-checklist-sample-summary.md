# Task 004 — Remove the checklist sample — Summary

- **Sprint:** sprint-102-desktop-rust-model
- **Completed:** 2026-11-20
- **Status:** done

## What was implemented
- **Crates:** `doc`, `ops` and `format` are deleted. `desktop/crates/` now holds `engine`, `model`, `shell`, `store` and `testkit`.
- **Engine:**
  - Removed the item, edit and file command modules, `document.inspect`, `DocState`, and everything on `Session` that existed for a document.
  - `Session` is now just `{storage}`.
  - `Session::execute` keeps its panic guard.
  - `command.list` returns exactly `command.list`, `settings.get`, `settings.set`.
  - Removed the `has_doc` enable check and the doc/format error conversions.
  - Dropped the three crate dependencies, and the non-dev `tempfile` dependency, which nothing outside tests used.
- **Shell:**
  - `UiState` is `{status}`. `ThemeKind`, the view-toggle shell commands, `PickKind`, `pick_file` and the picker branch in `menus::invoke` are gone.
  - `ui.set` accepts `{}` and rejects any field with "unknown field `x`".
  - `ui.inspect` returns `{ui, settings, menus}`.
  - The menu bar is generated from the registry's `menu` paths, so it is `[]` now. `MENU_ORDER`, `UI_COMMANDS` and `MenuItem.checked` are removed.
  - `Services` stays as an empty hook struct.
  - `Request::Invoke` stays.
  - `tests.rs` and `examples/view.rs` are rewritten on the new model.
- **App:**
  - Dropped the `[file]` argument, the document opened at start, the file picker, the `pistudiodesktop-format` dependency and the app's `services.rs`.
  - Removed the now-unused `crash_guard::guard` and its test; `install_hook` stays.
  - The control socket and token handling are unchanged.
  - The `control` and `invoke_command` page commands and the `view` event still compile.
- **CLI:**
  - Kept `commands [--filter]` and `run --cmd`.
  - Removed `info`, the file argument, `--new` and `--out`.
  - Added `run --config-dir <DIR>`; without it the session is in memory.
  - Replaced the tests in `tests/cli.rs`.
- **Testkit:** `adversarial_params` now uses the settings keys (`key`, `value`, `filter`).
- **xtask/Cargo:**
  - Removed the three rows from the layering table and updated the layer comment.
  - Rewrote the layering tests on `model` and `store`.
  - Removed the workspace dependency lines.
  - `Cargo.lock` follows.

## Files created / changed
| Path | Change |
|---|---|
| `desktop/crates/{doc,ops,format}/` | deleted |
| `desktop/crates/engine/src/{item_cmds,edit_cmds,file_cmds}.rs` | deleted |
| `desktop/crates/engine/{Cargo.toml,src/lib.rs,session.rs,commands.rs,error.rs,query_cmds.rs,tests/panic_hunt.rs}` | trimmed to the new model |
| `desktop/crates/shell/src/{lib,state,control,menus,services,tests}.rs`, `examples/view.rs` | rewritten |
| `desktop/crates/testkit/src/lib.rs` | adversarial params for settings |
| `desktop/apps/pistudiodesktop/src-tauri/{Cargo.toml,src/main.rs,bridge.rs,crash_guard.rs,control_server.rs}` | no file argument, no picker; doc comment example updated |
| `desktop/apps/pistudiodesktop/src-tauri/src/services.rs` | deleted |
| `desktop/apps/pistudiodesktop-cli/{src/main.rs,tests/cli.rs}` | `commands` + `run --config-dir --cmd` |
| `desktop/{Cargo.toml,Cargo.lock,xtask/src/layers.rs}` | workspace, lockfile and layering table |

## Build & test results
- `cargo xtask web` passed.
- `cargo xtask ci` passed all 8 steps (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm); 60 tests ran, 60 passed, 1 skipped. I ran it a second time after the last comment edit and it passed again.
- CLI smoke:
  - `run --config-dir $T --cmd 'settings.set {"key":"autoStartLocalDaemon","value":false}' --cmd settings.get` printed the changed setting twice.
  - `$T/settings.json` held `"autoStartLocalDaemon": false`.
  - `commands` lists the three commands.
- The `rg` check from the plan finds nothing apart from the control-server doc comment, which I then fixed.
- App smoke in the `pi-desktop-xvfb` container, with a freshly built binary and no file argument:
  - `engine.commands` returned exactly the three commands.
  - `ui.inspect` returned `{"menus":[],"settings":{"autoStartLocalDaemon":true,"cliPath":null},"ui":{"status":""}}`.

## Acceptance criteria
- [x] `desktop/crates/` holds only `engine`, `model`, `shell`, `store`, `testkit`, and no manifest names `doc`, `ops` or `format`. Checked with `ls` and `rg`.
- [x] `command.list` returns exactly `command.list`, `settings.get`, `settings.set`. Checked by a shell unit test, the CLI test and the app socket.
- [x] `ui.inspect` returns the status, the settings and an empty menu bar; `ui.set {"theme":"dark"}` is an error and `ui.set {}` succeeds. Checked by a shell test and the app socket.
- [x] A panicking command is reported as an error and the session keeps working. Checked by the rewritten `a_panic_in_a_command_is_an_error_and_the_session_survives`.
- [x] The CLI `--config-dir` smoke prints the changed setting and `<tmp>/settings.json` holds it. Checked by the smoke run and `tests/cli.rs`.
- [x] The app starts with no file argument and the control socket answers `engine.commands`. Checked in the container.
- [x] `cargo xtask ci` passes all eight steps.

## Follow-ups
- The app still builds `Session::new()` (in memory). Wiring the app to a config directory belongs to sprint-103.
- `tauri-plugin-dialog` is still registered in `main.rs`, because the capabilities file and sprint-104 dialogs use it.
- The old `pistudiodesktop` binary in `target/debug` was stale until I ran `cargo build -p pistudiodesktop`. `cargo xtask ci` does not rebuild it.

## Proposed doc edits for the orchestrator (task-005)
These still describe the sample:
- `desktop/AGENTS.md`, `desktop/README.md` and `desktop/docs/*`: the `doc`/`ops`/`format` crates and their layering rows, the item/edit/file commands, the `.pistudiodesktop` document and `[file]` argument, the `info` and `--new`/`--out` CLI commands, `document.inspect`, the theme and hide-completed UI state and view toggles, and `shellCommands` in the view.
- `ui.inspect` is now `{ui, settings, menus}`.
- `ui.set` takes no field.
- `desktop/docs/development.md`: the `pi-desktop-xvfb` smoke recipe is not written down. I ran the binary there with Xvfb and `/dev/tcp`.
- The frontend (`desktop/apps/pistudiodesktop/src`, not edited) may still read the removed `document`, `ui.theme` and `shellCommands` fields of the `view` event.

## Wave gate (orchestrator)
```
cargo xtask ci: all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm). Frontend does not read the view event (grep).
```
