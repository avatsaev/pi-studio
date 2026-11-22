# Task 002 — Wire: the envelopes and the file-transfer frames, tested against the published fixtures (D20)

- **Sprint:** sprint-120-desktop-transfer-wire
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/transfer/src/wire
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Rust builds and reads exactly the frames the daemon and the SDK exchange for a handshake, a request, liveness, an upload and a download.

## Context / why
This is the first Rust code that speaks the daemon's protocol (the proxy passes frames without reading them). The fixtures under `packages/protocol/fixtures/external-clients/` are the published contract.

## Scope references
- `swe/features/desktop-transfer-engine.md` § 3, § 4, § 5, decision D20
- `packages/protocol/fixtures/external-clients/`: `hello.agentStreams.json`, `status.server_info.json`, `ping.json`, `pong.json`, `rpc_error.json`, `file_upload_request.json`, `file_upload_response.json`, `file_upload_complete.json`, `file_download_request.json`, `file_download_request.range.json`, `file_download_response.json`, `file_download_response.rejected.json`, `file_download_cancel_request.json`, `file_download_cancel_response.json`, and `binary/file_transfer.{begin,begin.download,chunk,end,error}.json`; `README.md` there (how a fixture is read; compare `Begin` as parsed JSON, not bytes)
- `packages/protocol/src/binary-frames/file-transfer-protocol.ts` (opcodes `0x10`–`0x13`, the two-byte header, `End`'s one byte), `packages/protocol/src/messages.ts` (`helloSchema`, the `status` payload)
- `desktop/crates/model` (its test over `packages/workbench/.../normalize-url.vectors.json`: the precedent for a Rust test that reads a file of the monorepo)

## What to build
- Outbound text: `hello` (`clientType: "browser"`, `platform: "desktop"`, `agentStreams: "none"`, `protocolVersion: 1`, `appVersion`, `clientId`; no `capabilities`), a `session` request with a `requestId` for `file_upload_request`, `file_download_request` and `file_download_cancel_request`, `ping`, and `pong`.
- Inbound text, read no further than needed: `status` with `server_info` (the three feature flags), a `session` message with a `requestId` (its fields kept for the caller), `rpc_error`, `file_upload_complete`, `ping`, `pong`, and "anything else" by its `type` only.
- Binary: encode `Begin` (`{ transferId }`), `Chunk`, `End` and `Error` for an upload; decode `Begin` (its meta), `Chunk`, `End` and `Error` for a download. A frame shorter than its header, an unknown opcode, a `Begin` that is not the expected JSON, and numbers that do not fit are errors, not panics.
- Tests read the fixture files from the repository: every outbound frame equals its fixture's `frame` apart from the fields the fixture lists as `volatile` (and `capabilities` for `hello`); every inbound fixture is read into the expected value; the binary fixtures round-trip.

## Out of scope
- Sockets, timing, state (task-004 and sprint 121).

## Acceptance criteria
- [ ] Every fixture named above is used by a test, and the tests fail if a fixture's shape changes.
- [ ] A seeded loop of random and truncated inputs (text and binary) never panics and never allocates from a length it has not checked.
- [ ] Sizes and offsets are 64-bit: a `totalBytes` of 5 GiB and of 2^53 − 1 are read exactly.
- [ ] `cargo xtask ci` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-transfer`
- `cargo clippy -p pistudiodesktop-transfer --all-targets -- -D warnings`; `cargo fmt --all -- --check`
- `cargo xtask ci` in `desktop/`

## Notes
- Never crash: no unwrap, expect or panic outside tests, no unsafe; every size is checked before it is used.
- The daemon accepts any chunk length; the engine sends at most 32 KiB per `Chunk`, as the SDK does.
