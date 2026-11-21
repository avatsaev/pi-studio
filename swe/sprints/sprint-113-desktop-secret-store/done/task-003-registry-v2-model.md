# Task 003 — `model` crate: registry file version 2, without secrets

- **Sprint:** sprint-113-desktop-secret-store
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/model
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
The model can read a version 1 registry and split it into a version 2 document and the secrets to store, and reads and writes version 2.

## Context / why
P3 and P5. Version 2 drops `password` and `pairingLink` and keeps `hasPassword` on `local` and `direct` entries. The engine switches over in task-004; until then nothing uses the new types, so the workspace keeps building.

## Scope references
- `swe/features/desktop-transport-bridge.md` § Launch and migration, § Data & persistence touchpoints, decisions P3, P5
- `swe/features/desktop-daemon-registry.md` § Public contract 1 (the version 1 file and its rules)
- `desktop/crates/model/src/registry.rs` (`Registry`, `Entry`, `EntryView`, `decode_registry`, `VERSION`)

## What to build
- The version 2 document: as version 1 with `password` and `pairingLink` removed, and `hasPassword: boolean` on `local` and `direct` entries. Unknown fields are kept on rewrite; every rule and cap of version 1 that does not concern a secret is unchanged.
- Reading version 1 gives the version 2 document plus a list of `(entry id, kind, secret)`.
- Reading version 2 gives the document; a version above 2 is `UnknownVersion`, as today.
- Only version 2 is written.
- The version 1 types stay until task-004 removes their last user.

## Out of scope
- Any engine or shell change (task-004).
- Where secrets are stored.

## Acceptance criteria
- [ ] A version 1 file with a local password, a direct entry with a password and a relay entry gives a version 2 document with `hasPassword` set, no secret in it, and three secrets listed with the right ids and kinds.
- [ ] A version 2 document round-trips, unknown fields included; a relay entry has no link in it.
- [ ] Version 3 is refused as unknown; a version 2 file with a `password` field keeps it only as an unknown field and never treats it as a secret.
- [ ] The encoded bytes of version 2 contain no marker secret from the input.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-model`
- `cargo xtask ci` in `desktop/`

## Notes
- Checked on 2026-11-21: the released 0.1.0 app answers `UnknownVersion` to a version 2 file, sets it aside and shows only the local entry. P5 accepts that.
