# Task 005 — Rust-side documents after the sample, and the gate

- **Sprint:** sprint-102-desktop-rust-model
- **Status:** done
- **Type:** docs
- **Area:** desktop/docs, desktop/AGENTS.md, desktop/README.md, root AGENTS.md, docs/desktop-client-handoff.md
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-004

## Goal
Every document that describes the desktop app's Rust side says what the code is now: an engine with settings and stored workbench state, no checklist.

## Context / why
The desktop documents were written around the sample ("the Rust crates still hold the template's sample", item commands in every example). After task-004 those statements are false.

## Scope references
- `swe/features/desktop-native-host.md` § Public contract 5, § Removing the sample
- `desktop/AGENTS.md` ("Where it stands", workspace map, golden rules 3, 4, 7, 9)
- `desktop/README.md`, `desktop/docs/architecture.md` (the two halves, the layer table, "where new code goes", decisions), `desktop/docs/control-protocol.md` (methods and examples), `desktop/docs/contributing.md` (the command checklist), `desktop/docs/development.md` (CLI examples, "the sample engine's view as JSON")
- Root `AGENTS.md` (the `desktop/` paragraph of the monorepo layout), `docs/desktop-client-handoff.md` (status table row, § Rules in the desktop scaffold that must change, milestone 1 state)

## What to build
- Rewrite the passages above so they describe: crates `model` (L1), `store` (L3), `engine` (L5), `shell` (L6); commands `command.list`, `settings.get`, `settings.set`; `ui.inspect` returning the status, the settings and the menu model; the files in the configuration directory; the CLI's `commands` and `run --config-dir`.
- Replace every `item.*` example with a settings one that was actually run.
- Remove "the Rust crates still hold the template's sample" from every document, and the note in `desktop/AGENTS.md` that rules 3, 4 and 7 describe the sample.
- Leave the webview boundary section alone: sprint-103 changes it.

## Out of scope
- `swe/` specs and `swe/sprints/PLAN.md` beyond this sprint's own status.
- The workbench documents.

## Acceptance criteria
- [ ] No file under `desktop/` (outside `target/`) mentions the checklist, `item.` commands, or the `doc`, `ops`, `format` crates as existing.
- [ ] Every command line shown in `desktop/docs/control-protocol.md` and `desktop/docs/development.md` was run and its output matches.
- [ ] The root `AGENTS.md` desktop paragraph and the handoff document's status row no longer say the Rust crates hold the sample.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `rg -n -i "checklist|item\.(add|setDone)|crates/(doc|ops|format)" desktop docs/desktop-client-handoff.md AGENTS.md --glob '!target'`
- Run each documented command once and compare.
- `cargo xtask ci` in `desktop/`.

## Notes
- Markdown is not formatted by oxfmt; keep the existing structure and voice of each document.
