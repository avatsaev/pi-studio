# Task 003 — The pairing-link parser in `model`, with vectors shared with the SDK

- **Sprint:** sprint-124-desktop-relay-ssh-foundation
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/model, packages/client/src/pairing.ts (tests only), engine `daemon.add`/`daemon.update`
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Rust parses a pairing link exactly as the SDK does, and `daemon.add`/`daemon.update` refuse a link that does not parse.

## Context / why
The relay client needs the daemon's key and the relay's address from the link; the engine must refuse a bad link at entry (spec § 4). The SDK's parser does not check the key length; Rust does, and the shared vectors record the difference.

## Scope references
- `swe/features/desktop-relay-ssh.md` § 4, § 2 (`daemon.add`), § Edge cases (inputs)
- `packages/client/src/pairing.ts`, `pairing.test.ts`
- `desktop/crates/model/src/address_rule.rs` (the shared-vectors pattern)
- `desktop/crates/model/src/registry.rs` (`check_link`)
- `desktop/crates/engine/src/daemon_cmds.rs`

## What to build
- `model::pairing`: `parse(link) -> Result<PairingLink, RegistryError::InvalidLink>` with `daemon_key: [u8; 32]` and `target: Relay { host, tls } | Direct { host }`; its `Debug` hides the key.
- `pairing-link.vectors.json` beside `pairing.ts`: input and expected result (or `null`), read by `pairing.test.ts` and the Rust test. Cases: padding present and absent, a key of 31 and 33 bytes, `relay` with `wss://` and a trailing `/`, `relayTls=1`, `host` only, both `host` and `relay`, neither, no `#`.
- `check_link` parses; `daemon.add`/`daemon.update` answer `invalid_link`.

## Out of scope
- Using the link to connect (sprint 126).

## Acceptance criteria
- [ ] Both tests read the same vectors and pass.
- [ ] A link with a 31-byte key is `invalid_link` in Rust (the SDK accepts it; the vector says so).
- [ ] `daemon.add` with a bad link answers `invalid_link`.

## Test / verification plan
- `cd desktop && cargo xtask ci`
- `npx vitest run packages/client/src/pairing.test.ts`

## Notes
- `form_urlencoded` for the query; `base64` (standard, padding optional).
