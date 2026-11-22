# Task 002 — `ui.inspect`: the proxied connections and the last error — Summary

- **Sprint:** sprint-116-desktop-bridge-wiring
- **Completed:** 2026-11-22
- **Status:** done

## What was built
- Shell crate: `crates/shell/src/transports.rs` (plain serde data only, wasm-safe): `TransportState` (`connecting`, `open`, `closing`), `TransportView`, `ConnectionError { code, atMs }`, `Snapshot`. `Services` gained `transports: Option<TransportsHook>`. `control::view` fills `connection.transports` (`[]` without a hook), `connection.lastError` (`null` without a hook) beside `secretStore` and `resumeSignals`; each transport carries `peakHeldIn`/`peakHeldOut` (spec § 7).
- App: `Transport` in `src-tauri/src/transport.rs` records the code and time of any failed `transport_open` (including `address_mismatch`, `limit`, `secret_missing`, `internal`, not only dial errors); `Transport::inspector()` builds the hook; `lastError` is the newer of that and the proxy's last abnormal end (a tie goes to the abnormal end). Wired in `main.rs` and the test harness.

## Files changed
`crates/shell`: `src/transports.rs` (new), `lib.rs`, `services.rs`, `control.rs`, `tests.rs`, `tests/secret_guard.rs`. `src-tauri`: `src/transport.rs`, `main.rs`, `services.rs`, `commands/tests.rs`, `commands/tests/transport_tests.rs`. Docs: `desktop/docs/control-protocol.md` (the connections paragraph, the `ui.inspect` row), `desktop/docs/architecture.md`, `desktop/AGENTS.md`.

## Commands run
- `cargo test -p pistudiodesktop-shell -p pistudiodesktop`: shell 78, app 183 + 1 passed. Clippy `-D warnings` (shell, app, cli), `cargo fmt --check`, wasm32 check of shell, `cargo xtask layers`: ok.

## Wave gate (orchestrator, combined tree)
- `cargo xtask ci` in `desktop/`: all 8 steps passed. In `desktop/apps/pistudiodesktop`: `npm run check` ok, `npm run lint` clean, `npm test` 129 passed. No file under `packages/` changed in this wave, so the root npm gates were not re-run (last: 4,133 passed).

## Acceptance criteria
- [x] An open connection with frames exchanged shows one `open` transport with all four counters above zero (first `connecting`); after the page closes the list is empty and `lastError` stays null (test against a daemon stand-in and a page).
- [x] After a refused open `lastError.code` is `unauthorized`, then `address_mismatch` replaces it; after a client with a wrong token and no page, `page_refused` (the test takes about 10 s: it waits the real page lifetime).
- [x] The secret guard test scans the new fields with a marker token and a marker password; the app tests check `ui.inspect` has no password, token, `127.0.0.1` or message text.
- [x] `cargo xtask ci` passes (wave gate).

## Follow-ups / TODO(verify)
- A short-limit `Transport` constructor for tests would cut the 10 s wrong-token test; not added.
- `desktop/docs/control-protocol.md` still says `network` is "always 0 until the network watcher exists": stale since sprint 114; to correct in 117/t004.
