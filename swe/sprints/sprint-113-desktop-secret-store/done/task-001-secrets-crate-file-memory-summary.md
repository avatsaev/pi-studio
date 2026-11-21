# Task 001 — `secrets` crate: the store's contract, the memory and file backends — Summary

- **Sprint:** sprints/sprint-113-desktop-secret-store
- **Completed:** 2026-11-21
- **Status:** done

## What was implemented
New crate `pistudiodesktop-secrets` at L3 (may use `store`; registered with an intra-layer order `store` before `secrets`), empty on wasm32.
- `SecretStore` (`Send + Sync`): `kind()`, `get`, `set`, `delete` (deleting an absent key succeeds). `SecretKey` = entry id + `SecretKind` (`password`, `pairingLink`), named `<entry id>/<kind>`. `StoreKind`: `keychain`, `file`, `memory`. `SecretError`: `Unavailable`, `Denied`, `Failed`, each with `code()`.
- `Secret`: `Debug` and `Display` print `<secret>`; no `Serialize`, no `Deref`; `expose()` is the only way to the value. Not wiped on drop (needs `unsafe` or a crate; said in the crate docs).
- Both backends refuse an empty secret or one above the model's cap (1,024 password, 4,096 link characters).
- `MemoryStore`: a mutex-guarded map. `FileStore::open(dir)` returns `Opened { store, reset }`: reads `secrets.json` once; a file that cannot be read, is not JSON, has another version, a bad key or a refused value is set aside whole as `secrets.json.corrupt-<stamp>` (mode kept), the store starts empty and `reset` carries the kept name once. Every set and delete goes through `store::write_private`; a failed write rolls the map back.

## Files
`desktop/crates/secrets/**` (Cargo.toml, lib.rs, memory.rs, file.rs), `desktop/Cargo.toml`, `desktop/xtask/src/layers.rs` (+ a test), `desktop/AGENTS.md`, `desktop/README.md`, `Cargo.lock`. No new external dependency.

## Results
```
cargo test -p pistudiodesktop-secrets   21 passed (round trip both backends, 0600 after create and rewrite, corrupt file set aside with mode kept, marker never in {:?} {} {:#?})
cargo test -p xtask --bins              4 passed;  cargo xtask layers ok;  cargo xtask wasm ok (secrets builds empty)
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
- The model already has a `Secret` type; this crate keeps its own. The engine converts at the boundary (task-004).
- `docs/architecture.md` and rule 10 of `desktop/AGENTS.md` still say secrets live only in `daemons.json`: sprint-113/task-008 rewrites them.
- Task-004 turns `Opened.reset` into a notice.
- The subagent ran `cargo fmt --all` once while a sibling's files were half-written; the wave gate's fmt step passed.
