# Task 005 — Rust-side documents after the sample, and the gate — Summary

- **Sprint:** sprint-102-desktop-rust-model
- **Completed:** 2026-11-20
- **Status:** done

## What was implemented
- I rewrote the desktop docs to describe the post-sample Rust side. The crates are now `model` (L1), `store` (L3), `engine` (L5), `shell` (L6) and `testkit`.
- The documented commands are `command.list`, `settings.get` and `settings.set`.
- `ui.inspect` is documented as returning `{ui:{status}, settings, menus}`.
- `ui.set` is documented as accepting `{}` only.
- The configuration directory's `settings.json` and `daemon-state/<entry>.json` are described.
- The CLI is described as `commands [--filter]` and `run [--config-dir DIR] --cmd '<id> [json]'`.
- Every `item.*` example is replaced with a settings one that I ran.
- The "template's sample" notes are gone, including the note in `desktop/AGENTS.md` that rules 3, 4 and 7 describe the sample.
- The deleted `shell --example view` and the CLI `info` command, which no longer exist, are no longer documented.
- I added the `pi-desktop-xvfb` smoke recipe to `development.md`.
- I left the webview boundary section alone, apart from relabelling the `view` event row and the `engine` command row in the table.

## Files changed
| File | Change |
|---|---|
| `desktop/AGENTS.md` | "Where it stands", workspace map, rule 7 |
| `desktop/README.md` | Intro paragraph, "Where things are" table |
| `desktop/docs/architecture.md` | Two halves, layer table, seam 3 (storage), seam 5, decisions intro |
| `desktop/docs/contributing.md` | Command checklist: id examples, no `Session::edit` or undo, stored-file versioning |
| `desktop/docs/control-protocol.md` | Examples, methods table, trailing note |
| `desktop/docs/development.md` | CLI examples, removed the sample view example, added the xvfb smoke recipe |
| `AGENTS.md` | `desktop/` paragraph only |
| `docs/desktop-client-handoff.md` | Status row, "Rules in the desktop scaffold that must change", milestone 1 state and the sprint 102–106 text |

## Build & test results
- `cargo xtask ci` in `desktop/` passed all 8 steps: fmt, web, clippy, layers, test, panic_hunt, doctest, wasm.
- The documented CLI commands were run:
  - `commands --filter settings`
  - `run --cmd settings.get`
  - `run --config-dir ./cfg --cmd 'settings.set …' --cmd settings.get`
  - The output matches and `./cfg/settings.json` was created.
- The smoke recipe in `development.md` was extracted and run verbatim in `pi-desktop-xvfb`. Both replies matched what the doc shows.
- A control-protocol session was run in the container over `/dev/tcp`: `auth`, `engine.execute settings.set`, `ui.inspect`, `ui.set {"x":1}` (error), `ui.set {}` and an unknown method. All replies match the doc.

## Acceptance criteria
- [x] No `checklist`, `item.` or `doc`/`ops`/`format` crate mentions under `desktop/`. The `rg` check is clean for `desktop/`, root `AGENTS.md` and `docs/desktop-client-handoff.md`, except two handoff lines that say the checklist was removed.
- [x] Commands in `control-protocol.md` and `development.md` were run and their output matches, with one exception below.
- [x] The root `AGENTS.md` paragraph and the handoff status row no longer say the crates hold the sample.
- [x] `cargo xtask ci` passes.

## Follow-ups / TODO(verify)
- The `printf … | nc -q 2 127.0.0.1 7878` line in `control-protocol.md` was not run through `nc` from the host. The host could not reach the container's loopback port. The same wire lines were run in the container over `/dev/tcp`, and the replies match.
- The window's `src-tauri/bridge.rs` still builds `Session::new()`, so the app keeps settings in memory only. `AGENTS.md` and the architecture doc say the window does not call the engine yet. If the app-code task wires `--config-dir` or storage, the docs need one line saying so.
- `contributing.md` step 6 (collecting a file path in `menus::invoke` through a `Services` hook) was left as it was. I did not check it against the current shell code.

## Wave gate (orchestrator)
```
cargo xtask ci (run by the subagent) all 8 steps passed; documented commands run. Sprint-end full gate: see sprint-103/task-001 completion (combined tree).
```
