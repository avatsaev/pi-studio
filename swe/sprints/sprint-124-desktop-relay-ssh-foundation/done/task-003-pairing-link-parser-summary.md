# Task 003 — The pairing-link parser in `model`, with vectors shared with the SDK — Summary

- **Sprint:** sprint-124-desktop-relay-ssh-foundation
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- `model::pairing`: `parse(link) -> Result<PairingLink, InvalidLink>` (`daemon_key: [u8;32]`, `target: Relay{host,tls} | Direct{host}`; `Debug` hides the key). Form-encoded parameters after `#` (or the whole text), first value wins; `offer` base64 with or without padding, exactly 32 bytes; `relay` loses `http(s)://`/`ws(s)://` and trailing slashes; `relayTls=1` is TLS; `host` xor `relay`.
- `check_link` keeps the 1-4096 cap and calls `parse`, so `daemon.add` and `daemon.update` answer `invalid_link`.
- A small base64 decoder in `pairing.rs` matching the SDK's (no `base64` crate in the workspace).
- `packages/client/src/pairing-link.vectors.json`: 15 cases with `sdk` and `rust` results, read by `pairing.test.ts` and the Rust test. The 31-byte-key vector records that the SDK accepts it and Rust refuses.
- Fallout: relay-entry fixtures in engine, shell and app tests moved to links that parse.

## Files changed
`crates/model/{Cargo.toml,src/lib.rs,src/pairing.rs,src/registry.rs}`, `crates/engine/src/{local.rs,daemon_cmds/tests.rs}`, `crates/shell/src/{owner_access.rs,daemons.rs}`, `crates/shell/tests/secret_guard.rs`, `apps/pistudiodesktop-cli/tests/cli.rs`, `apps/pistudiodesktop/src-tauri/src/commands/tests.rs`, `commands/tests/transport_tests.rs`, `packages/client/src/pairing-link.vectors.json`, `pairing.test.ts`

## Build & test results
```
npx vitest run packages/client/src/pairing.test.ts -> 18 passed
cargo test -p model -p engine -p shell -> 32 / 64 / 211 passed
cd desktop && cargo xtask ci -> all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
```

## Acceptance criteria
- [x] Both tests read the same vectors and pass.
- [x] A 31-byte key is `invalid_link` in Rust.
- [x] `daemon.add` and `daemon.update` with a bad link answer `invalid_link`.

## Follow-ups
- none
