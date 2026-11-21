# Task 003 — `net` crate, pure parts — Summary

- **Sprint:** sprints/sprint-112-desktop-ipc-benchmark
- **Completed:** 2026-11-21
- **Status:** done

## What was implemented
New crate `pistudiodesktop-net` (`desktop/crates/net`), no dependencies, empty on wasm32, layer class `Layer(7)` (above `shell`, so `engine` and `shell` cannot use it; apps are exempt).
- `codec`: items `[kind][u32 LE length][payload]`; encode refuses above 128 MiB without touching the buffer; decode is an iterator that stops after the first error (`UnknownKind`, `Truncated`, `TooLarge`, `InvalidUtf8`, with offsets); the size cap is checked before the bounds check.
- `window`: `InboundWindow` (`on_sent`, `on_ack`, `may_read`), stops above 8 MiB outstanding, resumes below 4 MiB, an over-large acknowledgement is an error, counters saturate.
- `order`: `OrderBuffer<T>` with `push(seq, frame, now, &mut Vec<T>)`; `AlreadyPassed`, `Duplicate`, `TooManyEarly` (65th), `GapTooLong` (past 5 s, injected clock); every failure maps to the code `send_order`.
- `limits` holds all constants; `testing` is a seeded generator (no `rand`).

## Files
`desktop/crates/net/**`, `desktop/Cargo.toml` (one line), `desktop/xtask/src/layers.rs` (`("net", Layer(7))` and a test), `desktop/AGENTS.md`, `desktop/docs/architecture.md` (layer row), `Cargo.lock`.

## Results
```
cargo test -p pistudiodesktop-net   31 passed (round trip, every truncation, 20,000 random and mutated rounds, window boundaries, order)
cargo test -p xtask layers          4 passed, including net_is_usable_by_apps_only
cargo xtask layers                  ok (11 crates);  cargo xtask wasm  ok
```

## Wave gate (orchestrator, combined tree, 2026-11-21)
```
$ (cd desktop && cargo xtask ci)     all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
$ npm run build && npm run typecheck && npm run lint && npm test
  build 0, typecheck 0, lint 0 (warnings only in files this work did not touch), 291 files, 4132 tests passed
```

## Acceptance criteria
All six met.

## Follow-ups / TODO(verify)
- The spec now says `send_order` covers duplicates, a reused `seq` and the 65th early frame as well as the 5 s gap.
- The 64-message cap does not bound bytes: s115/t002 gained a 16 MiB byte cap.
- `Layer(7)` is above the UI minimum, so the layer check would allow `net` to depend on tauri (rule 4 forbids it; nothing does). A dedicated class is an option.
