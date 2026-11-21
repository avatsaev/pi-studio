# Task 003 — `model` crate: registry file version 2, without secrets — Summary

- **Sprint:** sprints/sprint-113-desktop-secret-store
- **Completed:** 2026-11-21
- **Status:** done

## What was implemented
In `desktop/crates/model/src/registry.rs` and `lib.rs`: `REGISTRY_V2`, `EntryV2` (`hasPassword` instead of `password` and `pairingLink`, unknown fields kept), `RegistryV2`, `MigratedSecret { id, kind, secret }` (a link for `relay`, a password otherwise), `Registry::into_v2()`, `decode_registry_v2`, `encode_registry_v2`, `decode_registry_any` (version 1 or 2; a version above 2 is `UnknownVersion`; secrets only from version 1). Version 2 follows version 1's rules (local entry created if missing, `lastUsedId` repaired, repeated ids and kind/field mismatches are `WrongShape`). `decode` takes the version through a new `decode_at`. The version 1 types and encoder stay for task-004 to remove.

## Results
```
cargo test -p pistudiodesktop-model   20 passed (v1 split into document and three secrets with hasPassword [true,true,false] and no marker in the encoded bytes; v2 round trip with unknown fields; version 3 refused; a v2 `password` field stays an unknown field)
cargo build --workspace               ok
```

## Wave gate (orchestrator, combined tree, 2026-11-21)
```
$ (cd desktop && cargo xtask ci)     all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
$ npm run build && npm run typecheck && npm run lint && npm test
  build 0, typecheck 0, lint 0 (warnings only in files this work did not touch), 291 files, 4132 tests passed
```

## Acceptance criteria
All five met.

## Follow-ups / TODO(verify)
- A relay entry with `hasPassword: true` is `WrongShape` in version 2: not stated in the spec; added there as a rule at close (task-008).
- Task-004 uses `decode_registry_any` and `encode_registry_v2`; `RegistryV2` has no views or add/update/remove yet.
