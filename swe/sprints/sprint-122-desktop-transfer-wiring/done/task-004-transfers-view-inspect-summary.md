## Task 004 summary: the transfers view and `ui.inspect`

`ui.inspect` now returns a `transfers` section with or without a hook, in the shape of spec § 8. The gates you listed pass: tests for both crates (85 + 209 + 1), clippy with `-D warnings`, `cargo fmt --check`, `cargo xtask layers` and `cargo xtask wasm`. I did not run `cargo xtask ci`, as instructed. The existing `tests/secret_guard.rs` test still passes unchanged, and I added no hook holding a marker path to it. The marker-path check is a unit test in `src/tests.rs`.

**What changed**
- **View types:** the new `desktop/crates/shell/src/transfers_view.rs` holds the camelCase data types. There is no field a path, an address, a handle or a secret could sit in, only ids, fixed words, counters and a fixed error code. `lastError` reuses `ConnectionError` from `transports.rs`.
- **Hook:** `services.rs` gains `TransfersHook` and `Services::transfers`, next to the `pick_files` hook that task-002 added.
- **Mode:** the hook's snapshot does not carry `mode`; the shell adds it from `app.transfers`.
- **`control.rs`:** `view` adds `transfers`. Without a hook it is the launch mode, a closed connection, an empty `active` list, zeros and `lastError: null`.
- **App binary:** `apps/pistudiodesktop/src-tauri/src/services.rs` sets `transfers: None`, so the `Services` initializer compiles. Task-005 fills it.
- **Docs:** `desktop/docs/control-protocol.md` has a new "The transfers" paragraph and the `ui.inspect` row mentions `transfers`. It says the section never holds a path, an address, a handle or a secret.
- **Tests:** `src/tests.rs` covers `ui.inspect` without a hook (page mode, empty section) and with a hook that holds a marker path (the path never appears in the output). The module also has its own serialisation tests.

**Choices of mine**
- The spec does not fix the type of an active transfer's `id`, so I made it a string.
- `queued` and the counters are `u64`.

I did not touch `desktop/crates/transfer`.

## Wave gate (orchestrator, combined tree)
```
cargo xtask ci (desktop/) -> all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
npm run typecheck -> ok; npm run lint -> 0 errors; npm test -> 296 files, 4211 tests passed
```
