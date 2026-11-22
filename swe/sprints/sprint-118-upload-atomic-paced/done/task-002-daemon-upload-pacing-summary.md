## Task summary — S118 T2: daemon upload pacing

**Built.** The daemon stops reading a session's socket while more than 1 MiB of an upload is unwritten. It resumes when every upload of that session is under 256 KiB.

- `FileTransferService` counts, per upload, the `Chunk` bytes received and not yet written.
  - It calls `session.pauseReading()` when any upload of the session goes above `UPLOAD_HIGH_WATER_BYTES` (1 MiB).
  - It calls `session.resumeReading()` when all uploads of the session are under `UPLOAD_LOW_WATER_BYTES` (256 KiB). Both constants sit beside the download marks.
  - An upload that ends, by success, failure or client `Error`, stops counting. `disposeSession` always resumes the session.
  - A new `deps.writeChunk` is the injectable write. Tests use it to slow the disk.
- `Session` gains `pauseReading()` and `resumeReading()`. They call the socket's `pause()` and `resume()`. A stand-in socket without them gets a no-op.
- **Relay session: it is paced.**
  - **What I found.** `RelayConnection` wraps the daemon's own per-client data socket, the `ws` socket opened by `openRelayConnection`. Its `message` handler feeds the client's frames into the channel, so that socket carries this client's frames. The relay's control socket is not touched.
  - **What I did.** `RelayConnection` now has `pause()` and `resume()`, which call `socket.pause()` and `socket.resume()`. `relay-sessions.ts`'s `socketFacade` passes them to `Session`.
  - **How I checked.** A unit test in `relay-sessions.test.ts` confirms `Session.pauseReading()` and `resumeReading()` reach the connection. I did not run a real relay with a real upload, so the end-to-end effect on a relay is `[INFERENCE]`.
- **Docs.** I added an "Upload pacing" bullet to `packages/server/AGENTS.md` and replaced the "not built" text in `swe/features/file-explorer-transfer.md`.

**Files changed.**
- `packages/server/src/files/file-transfer.ts`
- `packages/server/src/ws/session.ts`
- `packages/server/src/daemon/relay-connection.ts`
- `packages/server/src/daemon/relay-sessions.ts`
- Tests: `files/file-transfer.test.ts`, `daemon/relay-sessions.test.ts`
- Docs: `packages/server/AGENTS.md`, `swe/features/file-explorer-transfer.md`

**Commands run.**
- `npm run build:server`: passed.
- `npx vitest run packages/server/src/files packages/server/src/ws packages/server/src/daemon/relay`: 171 tests passed.
- `npx oxfmt` on the changed `.ts` files: done.
- `npm run lint`: no finding in changed files. An earlier `no-shadow` warning in `file-transfer.test.ts` is fixed. The remaining warnings are elsewhere in the repo (`web-client`, `client`, `relay`, `orchestration-rpc.ts`).

**Acceptance criteria.**
- [x] 64 MiB sent against a slowed writer: peak unwritten bytes never exceed 1 MiB plus one 32 KiB frame, reading pauses and resumes, and the file is complete (test "stops reading above 1 MiB…").
- [x] Two uploads on one session, one slow: reading stays stopped while the slow one is above the low mark, resumes after it drains, and both complete.
- [x] Session closes while stopped: the session resumes, temporary files are removed, nothing throws, and no target file is created.
- [x] A socket without `pause()` uploads as before.
- [x] The relay session is paced, as described above.

**Follow-ups.**
- Under `ws`, frames already parsed from the buffer being read when `pause()` is called may still be delivered, a few tens of KiB at most. This is an `[INFERENCE]`, and the tests use fake sockets, so it is not measured. Task-003 measures pacing on a real socket.

## Wave gate (orchestrator, combined tree)
```
npm run build -> ok; npm run typecheck -> ok; npm run lint -> 0 errors; npm test -> 295 files, 4204 tests passed
(first run: 2 failures in packages/workbench/src/host/files.test.ts, caused by sprint-119/task-002 removing the setStatus dep; the tests were moved onto the activity store and the gate re-run)
cargo xtask ci (desktop/) -> all 8 steps passed, including shell's process tests
```
