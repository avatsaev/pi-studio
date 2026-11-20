# Task 001 — `model` crate: the daemon registry — Summary

- **Sprint:** sprint-107-desktop-registry-model
- **Completed:** 2026-11-20
- **Status:** done

## What was implemented
New `registry` module in `pistudiodesktop-model`, re-exported from `lib.rs`.
- **Document:** `Registry { version, lastUsedId, entries, unknown }`. `Entry` holds `id`, `kind` (`local`/`direct`/`relay`), `name`, `address?`, `password?`, `pairingLink?`. Unknown fields are kept at both levels. `decode_registry` / `encode_registry` use the existing `decode`/`encode` helpers, so the failures are `NotJson`, `WrongShape` and `UnknownVersion`.
- **Normalising after a read:**
  - A missing `local` entry is created ("This machine").
  - A dangling `lastUsedId` becomes null.
  - Two `local` entries, a repeated id, or fields that don't match the kind make the document `WrongShape`. The mismatch check covers a `direct` entry without an address, a `relay` entry with a password, and a `local` entry whose id isn't `local`.
- **Operations:** `add(id, NewEntry)`, `update(id, Update)`, `remove(id)` and `set_last_used(id)` each return `Result<Registry, RegistryError>` and leave `self` untouched. `RegistryError::code()` gives the wire code.
- **Rules:**
  - Names are trimmed, 1–64 characters, and unique without regard to case. An entry may keep or re-case its own name.
  - Address is 1–2,048 characters, password 1–1,024 (empty is refused), pairing link 1–4,096, at most 64 entries.
  - `Update.password: Option<Option<Secret>>`, where `Some(None)` clears the password.
  - `wrong_kind` is checked before field validation.
  - Removing the entry `lastUsedId` names sets it to null.
- **Secrets:** `Secret` is a newtype whose `Debug` prints `<secret>`. `Entry` has a custom `Debug` that shows no password and no link. `EntryView { id, kind, name, address?, hasPassword }` carries no secret.
- **`LocalState`:** the nine states, tagged by `state`, with `FailReason`. It round-trips through JSON.
- **`EntryId`:** now serializes as a string and deserializes through `parse`, so a bad id is `WrongShape`. Added `EntryId::local()`.

## Files
| File | Change |
|---|---|
| `desktop/crates/model/src/registry.rs` | created: types, rules, codec, `LocalState`, 9 tests |
| `desktop/crates/model/src/lib.rs` | changed: `mod registry` and re-exports; `EntryId` serde and `local()` |

## Build & test results
- `cargo test -p pistudiodesktop-model`: 16 passed.
- `cargo clippy -p pistudiodesktop-model --all-targets -- -D warnings`: clean.
- `cargo fmt -p pistudiodesktop-model`: applied.
- `cargo xtask ci`: all 8 steps passed, including wasm.

## Acceptance criteria
- [x] A document without `local` gains one, and two `local` entries are `WrongShape`. Test `local_is_created_and_duplicated_is_wrong_shape`.
- [x] "Work" when "work" exists is `name_taken`, and renaming "work" to "Work" on the same entry is accepted. Test `names`.
- [x] A blank name, a 65-character name, a 2,049-character address, a 4,097-character link and a 65th entry each get their table code. Tests `names` and `sizes_and_limit`.
- [x] Changing a `relay` entry's address, or a `direct` entry's pairing link, is `wrong_kind`. Test `update_rules`.
- [x] Removing `local` is `local_not_removable`, and removing the last-used entry nulls `lastUsedId`. Test `remove_and_last_used`.
- [x] `EntryView` shows `hasPassword: true` and nothing else about the password, and `Debug` of an entry or the registry leaks neither secret. Test `secrets_stay_out_of_views_and_debug`.
- [x] Unknown fields survive decode then encode at both levels. Test `unknown_fields_survive`.
- [x] Each `LocalState` value round-trips through JSON. Test `local_state_json`.

## Follow-ups / TODO(verify)
- I added two error codes the spec table doesn't list:
  - `invalid_password` for an empty or oversize password. The table has no code for this case.
  - `invalid_id` when `add` gets `local` or an id already in the registry.
- Entry sizes (name, address, password, link) and the entry count are enforced only by the operations, not on decode. A hand-edited oversize entry still loads.

## Proposed doc edits for the orchestrator
- **Spec § Engine commands:** add `invalid_password` to the `add` and `update` error lists. It is raised when a password is empty or longer than 1,024 characters.
- **Spec § Engine commands:** `invalid_id` is an engine-internal guard (the engine generates ids), so it needs no wire entry.
- **`desktop/crates/model` layout:** `registry.rs` holds the registry document, its rules, `EntryView` and `LocalState`.
- **sprint-111/task-003:** record `checking` in the `LocalState` table, as the task notes.

## Wave gate (orchestrator)
```
Agent-run cargo xtask ci (8 steps) passed. Spec additions (invalid_password) carried to sprint-111/task-003.
```
