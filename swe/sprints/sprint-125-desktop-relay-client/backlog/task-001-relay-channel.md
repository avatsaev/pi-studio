# Task 001 — Relay crate: session id and the encrypted channel, against the fixtures

- **Sprint:** sprint-125-desktop-relay-client
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/relay
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-124/task-001

## Goal
The relay crate seals and opens channel records exactly as the TypeScript reference does, proven by the published fixtures.

## Context / why
D3 and the relay-protocol spec § 4. The fixtures use a fixed client key pair and salt, so the channel takes them as inputs in tests.

## Scope references
- `swe/features/desktop-relay-ssh.md` § 5, D3
- `swe/architecture/relay-protocol.md` § 4, § Channel
- `packages/relay/src/channel.ts`, `session-id.ts`
- `packages/protocol/fixtures/external-clients/relay/` (`manifest.json`, `keys.json`, `channel.*`)
- `packages/protocol/fixtures/external-clients/README.md` (Relay fixtures)
- `desktop/crates/transfer/src/wire/tests.rs` (how a Rust test reads the fixtures)

## What to build
- `session_id(daemon_key) -> String` (hex of the first 16 bytes of SHA-512).
- A channel state: `hello(my_public)`, `accept_ready(frame)` (salt, counter 0, plaintext `[0x00]`), `seal(kind, payload)`, `open(frame)`; counters per direction; refuse below 17 bytes, empty or unknown records, a `0x00` record after ready, a counter that would pass 2^64 − 1.
- Key pair generation from the OS random source; injectable in tests.

## Out of scope
- Sockets.

## Acceptance criteria
- [ ] A test reads the relay `manifest.json`, fails on an unlisted or missing file, accepts `formatVersion` 1 only, derives `sessionId` and `sharedKey`, rebuilds `hello`, `ready` and the two client-to-daemon frames byte for byte, and opens the two daemon-to-client frames.
- [ ] Each refusal case has a test.

## Test / verification plan
- `cd desktop && cargo xtask ci`

## Notes

