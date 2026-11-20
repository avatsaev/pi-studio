# Task 001 — `model` crate: settings, per-entry state, storage scopes — Summary
- **Sprint:** sprints/sprint-102-desktop-rust-model
- **Completed:** 2026-11-20
- **Status:** done

## What was implemented
New crate `pistudiodesktop-model` at layer 1. It depends only on `serde`, `serde_json` and `thiserror`, and does no I/O.
- **`Settings`:** has `version`, `autoStartLocalDaemon`, `cliPath` and `workbench`, plus a flattened `unknown` map that keeps unrecognised fields.
  - `Settings::set(name, &Value)` implements `settings.set`. Unknown key, wrong type and over-long path return errors and change nothing.
- **`EntryState`:** `{version, keys, unknown…}`.
- **Codecs:** `decode_settings`, `encode_settings`, `decode_entry_state` and `encode_entry_state`.
  - Decode errors are `NotJson`, `WrongShape` and `UnknownVersion`.
  - Encode writes pretty JSON with a trailing newline.
- **Storage scope:** `Scope::{Global, Entry}` and `scope_of(key)`. Only `pi-studio-appearance` is global.
- **Caps:** `check_put` checks a single write and `check_scope` checks a whole scope. The limits are 4 MiB per value, keys of 1–256 bytes, 256 keys and 16 MiB of values per scope.
- **`EntryId::parse`:** accepts `local` or a lower-case hyphenated UUID, and rejects everything else.

## Files created / changed
| File | Change |
|---|---|
| desktop/crates/model/Cargo.toml | new |
| desktop/crates/model/src/lib.rs | new, with 6 unit tests |
| desktop/Cargo.toml | added the workspace dependency line |
| desktop/xtask/src/layers.rs | added `("model", Class::Layer(1))` to `TABLE` and updated the layer doc comment |
| desktop/Cargo.lock | not modified (it did not show up as changed) |

## How it satisfies the scope
Everything in the task is implemented. The wasm crate list is derived from `TABLE`, so no separate edit was needed. Three choices go beyond the task text:
- A document with no `version` field is `WrongShape`, so `{}` on its own does not decode. The defaults come from `{"version":1}`.
- Decoding also enforces the caps on `workbench` / `keys` and the `cliPath` length, and a violation gives `WrongShape`.
- `encode_*` falls back to `{}` if serialization fails, so the functions stay total without `unwrap`. This cannot happen for these types.

## Build & test results
```
$ cargo test -p pistudiodesktop-model
test result: ok. 6 passed; 0 failed
$ cargo clippy -p pistudiodesktop-model --all-targets -- -D warnings
Finished (no warnings)
$ cargo xtask layers
pistudiodesktop-model L1 ...
layering: ok (10 crates)
$ cargo xtask wasm
Checking pistudiodesktop-model ... Finished
$ cargo fmt --check
(clean)
```

## Acceptance criteria
- [x] `{"version":1}` gives the defaults, and unknown fields survive decode then encode (unit test).
- [x] `version: 2` gives `UnknownVersion`, an array gives `WrongShape`, and non-JSON bytes give `NotJson` (unit test).
- [x] `pi-studio-appearance` is global, and `pi-studio-pane-layout`, `pi-studio-agent-todos-ui` and an unknown key are per entry (unit test).
- [x] A 4 MiB value is accepted and one more byte is refused; the key, count and total caps are enforced (unit test).
- [x] `local` and a UUID are valid entry ids; `../x`, `a/b`, the empty string and `LOCAL` are rejected (unit test).
- [x] `cargo xtask layers` lists the crate at L1 and `cargo xtask wasm` builds it (both ran).

## Follow-ups / TODO(verify)
none

## Proposed doc edits for the orchestrator
none

## Wave gate (orchestrator)
```
cargo fmt --check; cargo clippy --workspace --all-targets -D warnings; cargo test --workspace (all ok); cargo xtask layers (ok, 10 crates); cargo xtask wasm (ok)
```
