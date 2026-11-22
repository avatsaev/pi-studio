# Task 001 — New crate `pistudiodesktop-transfer` at layer 8; `net::dial` takes a message limit — Summary

- **Sprint:** sprints/sprint-120-desktop-transfer-wire
- **Status:** done. Only the `web` step of `cargo xtask ci` fails, and the cause is the sibling's files (see Build & test results).

## What was implemented
- **New crate `desktop/crates/transfer`.** It is native-only: every dependency sits behind `cfg(not(target_arch = "wasm32"))`, and `lib.rs` carries `#![cfg(not(target_arch = "wasm32"))]`. It depends on `pistudiodesktop-net` and `thiserror` only (no new third-party crate).
  - `limits.rs` holds the S3/D7 values as named constants: idle 30 s, ping after 10 s, dropped after 30 s, backoff 1 s to 30 s, answer 30 s, message 16 MiB, download hold 1 MiB, 3 transfers, 32 KiB chunk. A `Limits` struct with `Default` lets a test shorten any of them.
  - `error.rs` holds one `thiserror` enum `Error` with `Dial(#[from] DialError)`, `UnsupportedDaemon`, `Protocol`, `Timeout` and `Closed`. I chose these variants myself; the task did not list any.
- **`net::dial` takes the message limit.** The signature is now `dial(url, password, time_limit, max_message_bytes)`. `dial_with_roots` and `open` carry it through to the socket's `WebSocketConfig`. The proxy's caller in `transport.rs` and the proxy's test helper pass `MAX_MESSAGE_BYTES`, so the proxy behaves as before.
- **`layers.rs`:** `("transfer", Class::Layer(8))`, plus a new `TOP_LAYER = 8`. Apps now count as `TOP_LAYER + 1`; before, they counted as `UI_LAYER + 1` = 7, which would not have stopped `transfer` (L8) depending on an app. The comments and the `net` test are updated to match.
- **Docs.** The rule now reads "only `transfer` and an app binary may use `net`; only an app binary may use `transfer`". `desktop/AGENTS.md` has the `net` line changed and a new `transfer` line in the workspace map. `desktop/docs/architecture.md` has an L8 row, the dial's limit described as a parameter, and the "What stays out of the core" rule updated. `desktop/README.md` has the `transfer` row and the `net` usage note.

## Files created / changed
| File | Change |
|---|---|
| `desktop/crates/transfer/Cargo.toml`, `src/lib.rs`, `src/limits.rs`, `src/error.rs` | created (with unit tests) |
| `desktop/Cargo.toml` | workspace dependency line for `pistudiodesktop-transfer` |
| `desktop/Cargo.lock` | new package entry (`pistudiodesktop-net`, `thiserror`) |
| `desktop/crates/net/src/dial.rs` | `max_message_bytes` parameter on `dial`, `dial_with_roots`, `open`; `MAX_MESSAGE_BYTES` import removed |
| `desktop/crates/net/src/dial/tests.rs` | callers updated; new 16 MiB test |
| `desktop/crates/net/src/proxy/tests/support.rs` | `dial_for` passes `MAX_MESSAGE_BYTES` (only line changed) |
| `desktop/apps/pistudiodesktop/src-tauri/src/transport.rs` | passes `MAX_MESSAGE_BYTES` |
| `desktop/xtask/src/layers.rs` | table entry, `TOP_LAYER`, three new tests, one test renamed and extended |
| `desktop/AGENTS.md`, `desktop/docs/architecture.md`, `desktop/README.md` | rule text, workspace map, layer table |

## How it satisfies the scope
It follows spec § 9, S2 and S3. I changed `dial`'s signature rather than adding a second function, as the task said no aliases. The "proxy's tests pass unchanged" criterion holds in substance: no proxy test changed behaviour or assertions. One proxy helper line (`dial_for` in `proxy/tests/support.rs`) had to take the new argument, as did the `dial` calls in `dial/tests.rs`.

## Build & test results
```
$ cargo test -p pistudiodesktop-net -p pistudiodesktop-transfer -p xtask
net 84 passed; transfer 5 passed; xtask 8 passed; 0 failed

$ cargo clippy --workspace --locked --all-targets -- -D warnings   -> clean
$ cargo fmt --all -- --check                                       -> ok
$ cargo xtask layers   -> "layering: ok (12 crates)"; transfer L8 depends on net
$ cargo xtask wasm     -> ok (transfer is checked, empty on wasm32)
$ cargo xtask test     -> 602 tests run: 602 passed, 3 skipped; doctests ok
$ cargo test -p pistudiodesktop-engine --test panic_hunt -- --ignored -> 1 passed

$ cargo xtask ci
fmt ok; web FAIL: tsc -b: packages/workbench/src/host/browser-files.ts(12,8): TS2305
Module './types.js' has no exported member 'UploadOptions'
```
`cargo xtask ci` stops at `web` because of the sibling's in-progress TypeScript: `types.ts` and `browser-files.ts` under `packages/workbench` do not agree on `UploadOptions`/`TransferOptions`. I did not touch those files. Because `ci` stops at the first failure, I ran clippy, layers, tests, panic_hunt, doctests and wasm individually. All of them pass.

## Acceptance criteria
- [x] `cargo xtask layers` passes with the crate registered; the new tests `transfer_is_usable_by_apps_only` (engine, shell and net depending on `transfer` are flagged) and `transfer_may_not_use_an_app_or_a_ui_crate` (`tauri` is flagged) cover the violations. `net_is_usable_by_transfer_and_apps_only` covers the `net` side.
- [x] `cargo xtask wasm` passes.
- [x] The proxy's tests pass. The new test `dial::tests::a_socket_dialled_with_16_mib_refuses_a_larger_message_and_takes_one_of_that_size` takes a message of exactly 16 MiB and gets a `Capacity` error on 16 MiB + 1.
- [~] `cargo xtask ci`: every step except `web` passes (stated above). `web` fails only on the sibling's files.

## Follow-ups / TODO(verify)
- Re-run `cargo xtask ci` once the sibling's TypeScript compiles.
- The `Error` variants are a scaffold: task-002 may add or reshape them.
- `ipc-bench` calls no `net::dial`, so nothing changed there.

## Wave gate (orchestrator, combined tree)
```
npm run build -> ok; npm run typecheck -> ok; npm run lint -> 0 errors; npm test -> 292 files, 4159 tests passed
npm run fmt:check -> 28 files flagged, all pre-existing and none changed by this wave
cargo xtask ci (desktop/) -> all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
```
