# Task 003 — Daemon: download validator, per-session tracking, cancel

- **Sprint:** sprint-097-download-ranges
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (files)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002

## Goal
The daemon knows which downloads each session has running, can stop one on request, and refuses a range when the file changed since the client last saw it.

## Context / why
After task-002 a client can ask for any range, but three things are missing for resume and seeking. Nothing protects a later range from a file that changed in between. Nothing can stop a download except closing the socket, which would end every other transfer on that connection. And the daemon does not track downloads at all: the stream id is whatever the client sent, taken from the allocator uploads use.

## Scope references
- `swe/features/desktop-client-protocol-followups-2.md` § 1.1 (`stream`, `ifUnchanged`), § 1.2 (`stream_in_use`, `changed`), § 1.3 (`Error` messages), § 1.4, § Download (daemon), § Error handling & edge cases
- `packages/server/src/files/file-transfer.ts` (`registerHandlers`, `startDownload`, `takeStream`, `disposeSession`)
- `packages/server/src/files/file-transfer.test.ts`
- `packages/server/src/daemon/bootstrap.ts`, `dev-bootstrap.ts` (both already call `fileTransfer.disposeSession` when a direct or relay session ends; no change expected)

## What to build
- **Validator.** `file_download_request.ifUnchanged { size, mtimeMs }`: when present and not equal to the file's current size and truncated modification time, reject with `changed` and include the current `totalBytes` and `mtimeMs`.
- **Short read.** If the file ends before the announced `length` bytes were sent, send `Error` `changed` (no `End`). If the file grows, send only the announced bytes.
- **Tracking.** Record every running download under its session and stream id. Download stream ids are scoped to the session: two sessions may use the same id at once. Upload stream ids stay daemon-wide and daemon-allocated.
  - a request for a stream id that this session already has a download on is rejected with `stream_in_use`; the running download is unaffected;
  - a request without `stream` gets an id that is free on this session;
  - the id is released on `End`, on `Error`, and when the session closes.
- **Cancel.** `file_download_cancel_request { stream }` answers `{ ok: true }` and the daemon stops reading the file and sends `Error` `cancelled` on the stream; with no download of this session on that id it answers `{ ok: false, error: "not_found" }`.
- **Session close.** `disposeSession` stops every download of that session and closes its file handles. Nothing is sent.

Shared documents: `docs/desktop-client-handoff.md` and `swe/features/desktop-client-protocol-followups-2.md` are touched by most tasks of this sprint. Run alone, update what this task makes stale there. In a parallel wave, do not edit them: put the exact changes in the summary and the orchestrator applies them after the wave gate.

## Out of scope
- The SDK's use of cancel and `ifUnchanged` (task-004).
- Fixtures for the new request and response shapes (task-005).
- Any change to uploads.

## Acceptance criteria
- [ ] `ifUnchanged` with the current values is served; with stale values the request is rejected with `changed` and the current `totalBytes` and `mtimeMs`, and no binary frame is sent.
- [ ] A file truncated while it is being sent ends with `Error` `changed` after the bytes that could be read; a file that grows sends only the announced `length`.
- [ ] A second download on a stream id in use by the same session is rejected with `stream_in_use`; the same id on another session is accepted; after `End` the id can be reused.
- [ ] A request without `stream` is given an id that is free on that session.
- [ ] `file_download_cancel_request` on a running download answers `ok: true`, the client sees `Error` `cancelled`, and no further `Chunk` is read from the file (asserted, not assumed).
- [ ] Cancel after `End`, or for an unknown stream, answers `not_found`.
- [ ] Closing a session mid-download leaves no tracked download and no open file handle.
- [ ] Uploads behave exactly as before; every existing transfer test passes.

## Test / verification plan
- `npx vitest run packages/server/src/files packages/server/src/daemon/external-fixtures-e2e.test.ts`
- `npm run build:server`
- `npx oxfmt <changed files>`

## Notes
- The spec has no error for "this session has no free download stream" (256 downloads at once and `stream` omitted). Uploads use `no_free_stream` for the same condition. Reuse that code unless the engineer says otherwise, and record the choice in the spec's error table and in the summary.
- A file replaced by one of the same size within the file system's timestamp granularity is not detected. The spec accepts this.
- A cancel can race the end of a small file: `not_found` after `End` is correct, and a client ignores it.
