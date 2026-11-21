# Task 001 — `model` crate: settings, per-entry state, storage scopes

- **Sprint:** sprint-102-desktop-rust-model
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/model (new)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
The desktop app's own data exists as plain, validated Rust types with JSON codecs: the settings, one daemon entry's stored state, and the rule that decides where a workbench storage key is kept.

## Context / why
The Rust side still models a checklist. The desktop host needs settings and the workbench's stored keys in files owned by Rust (D1). This crate is the pure-data bottom layer the engine, the store and later the daemon registry build on. It does no file access.

## Scope references
- `swe/features/desktop-native-host.md` § Storage, § Settings, § Public contract 5 (row "Model"), § Data & persistence touchpoints
- `swe/grills/desktop-native-shell.md` D1, D20
- `desktop/AGENTS.md` (golden rules 2, 4, 7), `desktop/xtask/src/layers.rs` (`TABLE`), `desktop/Cargo.toml` (`[workspace.dependencies]`)
- `desktop/crates/doc/` (the crate this replaces later; copy its manifest shape and lint header, not its content)

## What to build
- Create `desktop/crates/model` (`pistudiodesktop-model`), layer 1: add its row to `TABLE` and its line to the workspace dependencies. Depends on `serde`, `serde_json`, `thiserror` only.
- `Settings`: `version` (1), `autoStartLocalDaemon` (boolean, default `true`), `cliPath` (string or null, default null, at most 4,096 characters), `workbench` (string to string map: the workbench's global keys). Fields it does not know are kept and written back.
- `EntryState`: `{ version: 1, keys: { [key]: string } }`, unknown fields kept.
- Storage scope: `pi-studio-appearance` is global; every other key belongs to the current daemon entry.
- Caps (the first is the spec's; the rest are chosen here because every size needs one): a value at most 4 MiB; a key 1–256 bytes; at most 256 keys and 16 MiB of values per scope.
- Entry id: `local`, or a lower-case hyphenated UUID. It becomes a file name, so anything else is rejected.
- Codecs for both documents: decode returns the value or one of `NotJson`, `WrongShape`, `UnknownVersion`; encode writes pretty JSON with a trailing newline.
- Setting by name, for `settings.set`: `autoStartLocalDaemon` takes a boolean, `cliPath` a string or null; an unknown key, a wrong type or an over-long path is an error and changes nothing.

## Out of scope
- Reading or writing files (task-002), commands (task-003).
- The daemon registry's types (`swe/features/desktop-daemon-registry.md`: sprint-107/task-001).

## Acceptance criteria
- [ ] Decoding `{}` with `version: 1` gives the defaults; decoding then encoding a document with unknown fields keeps them.
- [ ] `version: 2`, a JSON array and non-JSON bytes give `UnknownVersion`, `WrongShape` and `NotJson`.
- [ ] `pi-studio-appearance` is global; `pi-studio-pane-layout`, `pi-studio-agent-todos-ui` and an unknown key are per entry.
- [ ] A 4 MiB value is accepted and one byte more is refused; the key, count and total caps are enforced.
- [ ] `local` and a UUID are valid entry ids; `../x`, `a/b`, the empty string and `LOCAL` are not.
- [ ] `cargo xtask layers` lists the crate at L1 and `cargo xtask wasm` builds it.

## Test / verification plan
- `cargo test -p pistudiodesktop-model` (in `desktop/`)
- `cargo clippy -p pistudiodesktop-model --all-targets -- -D warnings`
- `cargo xtask layers && cargo xtask wasm`

## Notes
- No `unwrap`, `expect` or `panic!` outside tests (workspace lints deny them).
- JSON field names are camelCase, as in the spec.
