# Task 002 — Keychain backend — Summary

- **Sprint:** sprints/sprint-113-desktop-secret-store
- **Completed:** 2026-11-21
- **Status:** done

## What was implemented
`KeychainStore` in `desktop/crates/secrets` over the OS keychain, using `keyring-core` plus one store crate per platform (the `keyring` wrapper's README recommends this; it avoids a process-global default store). Linux and other non-Apple Unix: `zbus-secret-service-keyring-store` (pure Rust, `crypto-rust`, no libdbus); macOS: `apple-native-keyring-store` (`keychain`); Windows: `windows-native-keyring-store`; elsewhere an `Unavailable`-style error. Dependencies are per target; `cargo tree` shows no normal dependency on wasm32.
- Item names: service `com.avatsaev.pi-studio`, account `<scope>/<entry id>/<kind>`; `Scope::standard()` is `default`, `Scope::for_config_dir(path)` is 16 hex digits of FNV-1a 64 over the path bytes (written by hand: std hashers promise no stability; the caller must pass the same form of path each launch).
- `KeychainStore::probe(scope)` reads a key that does not exist on a helper thread and waits 2 s (`PROBE_TIMEOUT`): a hang or `PlatformFailure` is `Unavailable`, `NoStorageAccess` is `Denied`, a panic is `Failed`.
- Operations map errors by kind (`NoEntry` is `None` on get and `Ok` on delete; kinds carrying stored bytes get fixed text; detail is one line capped at 200 characters); caps are applied on get and set. The module never logs.
- `FakeKeychain` (public, in-memory `keyring-core` store: `blocking(delay)`, `fail_with(..)`, `calls()`, `held()`, `names()`, `put_raw()`) for tests; task-004 used it.
- Files: `crates/secrets/{Cargo.toml, src/keychain.rs, src/fake.rs, src/lib.rs, tests/keychain_live.rs}`, `desktop/Cargo.toml` (four lines), `Cargo.lock`, `desktop/docs/development.md` (new section "The keychain in the container"), `desktop/AGENTS.md`, `desktop/README.md`. `ATTRIBUTION.md` needs no row (it lists assets, not crates).
- Licences (newly in the lock; all MIT OR Apache-2.0, `cmov`, `ctutils`, `zeroize` Apache-2.0 OR MIT): keyring-core 1.1.0, zbus-secret-service-keyring-store 1.0.1, secret-service 5.2.0, apple-native-keyring-store 1.0.2, windows-native-keyring-store 1.1.0, security-framework 3.7.0 and -sys 2.17.0, aes, cbc, cipher, block-padding, inout, hkdf, hmac, sha2 (0.10.9 and 0.11.1), cmov, cpubits, ctutils, zeroize, num and its five parts.

## Results
```
cargo test -p pistudiodesktop-secrets   33 passed (12 new), 2 ignored (live)
container with a Secret Service (derived image pi-desktop-keyring = pi-desktop-xvfb + gnome-keyring + libsecret-tools; dbus-run-session; unlock then start gnome-keyring-daemon):
  set/get/delete round trip ok; `secret-tool lookup service com.avatsaev.pi-studio username <scope>/local/password` returns the value, nothing after delete; same for pairingLink; a second scope reads None
container without one: probe is `unavailable` in 1.5 ms (a bus nobody answers on) and 0.26 ms (no bus)
```

## Wave gate (orchestrator, combined tree, 2026-11-21)
```
$ (cd desktop && cargo xtask ci)     all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
$ npm run build && npm run typecheck && npm run lint && npm test     all exit 0; 291 files, 4132 tests passed
$ (cd desktop/apps/pistudiodesktop && npm run check && npm run lint && npm test)     exit 0; 112 tests passed
```

## Acceptance criteria
All six met (the macOS and Windows store crates were not compiled here: those targets are not installed).

## Follow-ups / TODO(verify)
- **Probe blind spot:** the probe only reads a missing item. A Secret Service whose default collection is locked or absent passes it, and the later `set` returns `Denied`. Task-006 now also writes and deletes a throwaway item at launch (added to its task file).
- macOS and Windows store crates: compiled and exercised by sprint 117's runner checks; unsigned-build prompts not examined.
- A locked collection with a real prompter (display) was not run; without a display a prompt would block.
- The gnome-keyring unlock-then-start order in the doc is empirical.
- Spec TODO(verify) "The keychain crate" can be closed: backends and licences as above; the Linux backend needs a D-Bus session bus and a service.
- The derived image `pi-desktop-keyring` stays on this machine.
