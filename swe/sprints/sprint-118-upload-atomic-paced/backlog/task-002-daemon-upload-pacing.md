# Task 002 — Daemon: an upload is paced by not reading the session's socket (R4)

- **Sprint:** sprint-118-upload-atomic-paced
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server/src/files, packages/server/src/ws
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
While more than 1 MiB of an upload waits to be written, the daemon reads nothing from that session; a sender is slowed through TCP and the daemon's memory stays bounded.

## Context / why
`handleUploadFrame` chains writes per stream without a bound: a fast sender and a slow disk grow the daemon by the size of the file. Downloads are already paced (`DOWNLOAD_HIGH_WATER_BYTES`). The SDK paces on `bufferedAmount` and the Rust engine awaits each write, so both obey a socket that is not read. Spec decision R4.

## Scope references
- `swe/features/desktop-transfer-engine.md` § 10 (Pacing), decision R4, § TODO(verify) (the browser's one connection; the relay)
- `packages/server/src/files/file-transfer.ts` (the upload chain, `DOWNLOAD_HIGH_WATER_BYTES` / `DOWNLOAD_LOW_WATER_BYTES`, the injected `deps`)
- `packages/server/src/ws/session.ts` (`Session`, `bufferedAmount`), `ws-server.ts`; the relay session's socket (`packages/server/src/relay/`)
- `ws` 8.21: `WebSocket.pause()`, `resume()`, `isPaused`

## What to build
- `Session` gains two calls that stop and continue reading its socket (a direct session: the `ws` socket's `pause()` / `resume()`; a relay session: the same on its data socket, if that is what carries the client's frames; a stand-in socket without them: no-ops).
- `FileTransferService` counts, per upload, the bytes of `Chunk`s that arrived and are not yet written. Above 1 MiB for any upload of a session: stop reading that session. When every upload of the session is under 256 KiB: read again. The two marks are named constants beside the download's.
- An upload that ends in any way (success, failure, client `Error`, `disposeSession`) leaves the session reading, unless another of its uploads is still above the mark.
- Tests use an injected slow write (the service already takes injected `deps`).
- `packages/server/AGENTS.md` and `swe/features/file-explorer-transfer.md` describe the pacing.

## Out of scope
- A new message or flag: the wire is unchanged.
- Pacing the SDK or the engine differently.

## Acceptance criteria
- [ ] Given a writer slowed in the test and a client that sends 64 MiB without waiting, then the bytes waiting for that upload never exceed 1 MiB plus one frame, reading stops and continues at least once, and the file is complete.
- [ ] Given two uploads on one session where only one is slow, then reading continues only when both are under the low mark, and both complete.
- [ ] Given a session that closes while it is stopped, then its uploads are released, their temporary files removed, and nothing throws.
- [ ] Given a session socket without `pause` (the tests' stand-in), uploads work as before.
- [ ] The summary says whether a relay session is paced, and how that was checked.

## Test / verification plan
- `npm run build:server`
- `npx vitest run packages/server/src/files packages/server/src/ws`
- `npx oxfmt <changed .ts files>`; `npm run lint`

## Notes
- On the browser's one connection a stopped socket also delays that client's other requests while the disk is behind. That is accepted; task-003 measures it.
- Do not stop the relay's control socket: only the socket that carries this client's frames.
