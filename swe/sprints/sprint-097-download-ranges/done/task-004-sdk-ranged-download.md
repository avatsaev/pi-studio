# Task 004 — SDK: download by path with range, streaming sink, progress and abort

- **Sprint:** sprint-097-download-ranges
- **Status:** done
- **Type:** feature
- **Area:** packages/client (file transfer), packages/cli (end-to-end test)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-003

## Goal
`FileTransferClient` downloads through the new daemon contract, can hand chunks to a sink without keeping them, and can be aborted.

## Context / why
The SDK still requests a token, which the daemon no longer serves (task-002), so every download through the SDK fails until this task lands. Its `download` also keeps every chunk and concatenates them, and offers no range, progress or cancel. The desktop client's reference behaviour and the web client both depend on this class.

## Scope references
- `swe/features/desktop-client-protocol-followups-2.md` § 1.6, § 1.8, § `downloadTo` (SDK), § Resuming and seeking
- `packages/client/src/file-transfer-client.ts` (`download`, `dispatch`, the pending-download map, `EXPIRED_TOKEN`, `TokenResponse`, `abortError`)
- `packages/client/src/daemon-client.ts` (`hasFeature`, `request`)
- `packages/client/src/file-transfer-client.test.ts`, `packages/client/src/test-support/scripted-daemon.ts`
- `packages/client/src/index.ts` (exported types), `packages/client/AGENTS.md`, `packages/client/README.md`
- `packages/cli/src/file-transfer-sdk-e2e.test.ts` (the SDK against a real in-process dev daemon; uploads only today)

## What to build
- `downloadTo(path, sink, options?)`: calls `sink(chunk)` once per `Chunk`, in wire order, and keeps no reference to the chunk. Resolves after `End` with `{ fileName?, mimeType?, totalBytes, mtimeMs, offset, length }`.
- `download(path, options?)`: the same flow collecting the range into one buffer. Its result keeps `bytes`, `fileName`, `mimeType` and gains `totalBytes`, `mtimeMs`, `offset`.
- `options` for both: `offset?`, `length?`, `ifUnchanged?: { size, mtimeMs }`, `signal?`, `onProgress?(received, length)`.
- Flow: pick a free stream id and register it **before** sending `file_download_request { path, stream, offset, length, ifUnchanged }`; a response with `ok: false` releases the id and rejects with the daemon's `error` code; `Error` rejects with the frame's message; a closed connection or `stop()` rejects.
- Abort: `signal` aborting sends `file_download_cancel_request { stream }`, releases the id and rejects with an `AbortError`. Frames that still arrive for a released id are ignored.
- Feature gate: when the daemon did not advertise `fileDownloadRanges`, reject before sending anything, with a message that names the feature and says the daemon must be updated.
- Delete the token request, the token types and the retry-on-expired path.
- End-to-end cases in `file-transfer-sdk-e2e.test.ts`: a whole file; two consecutive ranges whose concatenation matches; a download interrupted by abort and resumed with `offset` and `ifUnchanged` to a matching SHA-256; resume after the file was modified rejects with `changed`.

Shared documents: `docs/desktop-client-handoff.md` and `swe/features/desktop-client-protocol-followups-2.md` are touched by most tasks of this sprint. Run alone, update what this task makes stale there. In a parallel wave, do not edit them: put the exact changes in the summary and the orchestrator applies them after the wave gate.

## Out of scope
- The browser host's use of `downloadTo` (task-006).
- `HtmlViewer`'s direct `download` call: it keeps working unchanged.
- Uploads.

## Acceptance criteria
- [ ] `downloadTo` delivers chunks in wire order and retains none: a test downloads several megabytes with a sink that discards, and the client holds no chunk afterwards.
- [ ] `onProgress` is monotonic and ends at `length`.
- [ ] `download` with `offset` and `length` returns exactly that range, with `totalBytes`, `mtimeMs` and `offset` in the result.
- [ ] Aborting rejects with `AbortError`, sends the cancel request and frees the stream id, which the next download can reuse.
- [ ] A rejected request (`not_found`, `changed`, `stream_in_use`…) rejects with that code and leaves no pending entry.
- [ ] Against a daemon without `fileDownloadRanges`, `download` and `downloadTo` reject with the update-the-daemon message and send nothing.
- [ ] No token request, token type or expired-token retry remains in `packages/client`.
- [ ] The end-to-end cases above pass against the real dev daemon.

## Test / verification plan
- `npx vitest run packages/client/src packages/cli/src/file-transfer-sdk-e2e.test.ts`
- `npm run build:client && npm run build:cli`
- `npx oxfmt <changed files>`

## Notes
- The response now arrives before `Begin`. Register the stream before the request is sent so a fast daemon cannot deliver frames to an unknown id.
- `transport.ts` documents a past bug where out-of-order binary delivery truncated downloads; keep the synchronous, in-order dispatch.
- `sink` is synchronous by contract. A consumer that needs to wait (writing to disk) has to buffer or pace by asking for ranges; say so in the JSDoc.
