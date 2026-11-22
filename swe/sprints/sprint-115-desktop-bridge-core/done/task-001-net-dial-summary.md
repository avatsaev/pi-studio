# Task 001 — `net` crate: dialling — Summary

- **Sprint:** sprint-115-desktop-bridge-core
- **Completed:** 2026-11-22
- **Status:** done

## What was built
`dial(url, password, limit) -> Result<Socket, DialError>` in `pistudiodesktop-net` (`DIAL_LIMIT` 15 s). `Socket` is a `WebSocketStream` over TCP or TLS. Exports `DialError { code, message, tls_reason }`, `ErrorCode`, `TlsReason` (`Expired`, `NotYetValid`, `UnknownIssuer`, `WrongName`, `Revoked`, `Other`).
- Refused before any network use: a scheme other than `ws`/`wss`, user information, a fragment, a non-numeric port, a password that cannot go in a subprotocol (`invalid_address`; the last one answers `handshake`). The message never repeats the URL.
- `Host` is written by hand as a browser sends it (default port dropped). Subprotocol `pi-studio.bearer.<password>` only for a non-empty password.
- `TCP_NODELAY`; keepalive 30 s idle, 10 s interval, 3 probes (Windows: idle and interval only, via `socket2`).
- Message size config 128 MiB (`MAX_MESSAGE_BYTES`) set at dial (the only place the config can be set); task-002 may change it.
- TLS: `rustls` with `ring` and `rustls-platform-verifier`; no option accepts an untrusted certificate (a private test-only function adds a trust root).
- Codes: `unreachable`, `tls` (with reason), `unauthorized` (401), `host_not_allowed` (403), `handshake` (other), `timeout`. Messages name host and port, never the password.

## Files changed
New in `desktop/crates/net/src/`: `address.rs`, `error.rs`, `stream.rs`, `tls.rs`, `dial.rs`, `dial/tests.rs`. Edited: `lib.rs`, `crates/net/Cargo.toml`, `desktop/Cargo.toml`, `desktop/Cargo.lock`, `desktop/docs/architecture.md` (layer row; "Sockets live in `net` only"), `desktop/AGENTS.md` (the `crates/net` line).

## Commands run
- `cargo test -p pistudiodesktop-net`: 69 passed (five runs, none flaky). `cargo clippy -p pistudiodesktop-net --all-targets -- -D warnings`: clean. wasm32 check: ok (dependencies under `cfg(not(target_arch = "wasm32"))`). `cargo xtask layers`: ok. `cargo build --workspace --exclude xtask`: ok.

## Wave gate (orchestrator, combined tree)
- `cargo xtask ci` in `desktop/`: all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm).
- Root `npm run build && npm run typecheck && npm run lint && npm test`: exit 0; 291 files, 4,133 tests passed.

## Acceptance criteria
- [x] Plain server connects; 401, 403, 500 give `unauthorized`, `host_not_allowed`, `handshake`; a silent server gives `timeout` at the limit; a closed port and an unresolvable name give `unreachable`.
- [x] Certificates made in the test (`rcgen`): unknown issuer (through the real dial against the system store), expired and wrong name (test-trusted CA) each give `tls` with the matching reason; a plain server on a `wss` address gives `tls`.
- [x] Marker password: the server saw `pi-studio.bearer.<marker>` on plain and wss; no message, `Display` or `Debug` holds it; the crate has no `log` dependency.
- [x] A URL with user information, `http`, `https`, `ftp` or a bare `host:port` is refused and a listener sees no connection.
- [~] Licences listed below; the build needs only a C compiler (read from `ring`'s `build.rs`); the macOS and Windows builds were not seen.
- [x] `cargo xtask ci` passes including wasm (wave gate).

## Licences
Direct: `tokio-rustls` 0.26.6 (MIT OR Apache-2.0), `rustls-platform-verifier` 0.7.1 (MIT OR Apache-2.0), `rcgen` 0.14.10 (dev; MIT OR Apache-2.0); `socket2`, `tokio`, `tokio-tungstenite` were in the lock already. Runtime tree on Linux: `rustls` 0.23.46 (Apache-2.0 OR ISC OR MIT), `rustls-webpki` (ISC), `untrusted` (ISC), `subtle` (BSD-3-Clause), `rustls-native-certs`, `openssl-probe`, `rustls-pki-types`, `ring` 0.17.14 (Apache-2.0 AND ISC: `LICENSE-other-bits` ISC, `LICENSE-BoringSSL` Apache-2.0 text; no OpenSSL or SSLeay text in this version; both permissive, rule 9 met; a redistributed binary should carry both notices). macOS adds `security-framework`, Windows `windows-sys` (both MIT OR Apache-2.0; not compiled here). `webpki-root-certs` (CDLA-Permissive-2.0) is wasm only. No `aws-lc-rs`.

## Follow-ups / TODO(verify)
- The macOS and Windows builds and tests were not run here; the expired-certificate reason check is skipped on Apple (the platform verifier may not report expiry); the platform verifiers with a test root need a look on the runners.
- tungstenite 0.30 fails the upgrade (`handshake`) if a subprotocol is offered and the daemon answers none; browsers accept that. The daemon always echoes, so it matters only behind a proxy that strips it.
- Addresses are tried one after another within the single limit (no parallel attempts).
- Spec § TODO(verify), TLS licences: answered here (`rustls` 0.23 + `ring` 0.17.14 + `rustls-platform-verifier` 0.7.1, permissive, `ring` needs a C compiler only).
