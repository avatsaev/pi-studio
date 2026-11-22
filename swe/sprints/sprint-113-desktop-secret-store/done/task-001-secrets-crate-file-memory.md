# Task 001 — `secrets` crate: the store's contract, the memory and file backends

- **Sprint:** sprint-113-desktop-secret-store
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/secrets
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
A new crate defines the secret store and two backends that need no operating-system service.

## Context / why
P3 and P4. Passwords and pairing links leave `daemons.json`. Where no keychain exists they go to `secrets.json`, mode 0600; tests and a session without a configuration directory use memory. The keychain backend is task-002.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 5 (contract, backends, `secrets.json`), § Data & persistence touchpoints, § 8
- `desktop/crates/store/src/write.rs` (`write_private`: created at mode 0600), `read.rs` (a corrupt file is set aside)
- `desktop/crates/model/src/registry.rs` (the caps: a password 1,024 characters, a pairing link 4,096)
- `desktop/xtask/src/layers.rs` (`TABLE`, `INTRA_LAYER_ORDER`)

## What to build
- Crate `pistudiodesktop-secrets` at L3, allowed to use `store` (an intra-layer order entry), empty on wasm32.
- A key is an entry id and a kind (`password`, `pairingLink`). Operations: get (a secret or none), set, delete (deleting what is absent succeeds). Errors: `unavailable`, `denied`, `failed`. Each backend reports its kind: `keychain`, `file`, `memory`.
- A secret is a type of its own whose debug and display output never shows the value; an error never carries one.
- Memory backend: a map.
- File backend: `secrets.json` in a given directory, `{ version: 1, items: { "<entry id>/<kind>": string } }`, written through `store::write_private`. A file that cannot be read is set aside as the other files are and the store starts empty; the caller gets a notice. A value above the registry's cap for its kind is refused.

## Out of scope
- The keychain (task-002).
- Using the store from the engine (task-004).

## Acceptance criteria
- [ ] Set, get and delete round-trip in both backends; deleting an absent key succeeds.
- [ ] On Unix `secrets.json` is mode 0600 from the moment it exists, also after a rewrite.
- [ ] A corrupt `secrets.json` is set aside with its mode kept, the store answers as empty, and a notice is returned once.
- [ ] Formatting a secret or an error with `{:?}` or `{}` shows no part of the value (tested with a marker).
- [ ] `cargo xtask ci` passes: the layer check accepts the crate, and the wasm step builds it empty.

## Test / verification plan
- `cargo test -p pistudiodesktop-secrets`
- `cargo xtask ci` in `desktop/`

## Notes
- No `unsafe`: if wiping memory on drop needs a crate, check its licence; leaving it out is acceptable and is said in the summary.
- A `*.corrupt-*` copy of `secrets.json` may hold secrets and is kept on purpose, as for `daemons.json`: the documents say so in task-008.
