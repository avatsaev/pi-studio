# Task 004 — SDK: download by path with range, streaming sink, progress and abort — Summary

- **Sprint:** sprints/sprint-097-download-ranges
- **Completed:** 2026-11-15
- **Status:** done

## What was implemented
`FileTransferClient` (packages/client) downloads through the new daemon contract:
- `downloadTo(path, sink, options?)` calls a synchronous sink once per `Chunk` in wire order and keeps no chunk; resolves after `End` with `{ fileName?, mimeType?, totalBytes, mtimeMs, offset, length }` taken from `Begin`.
- `download(path, options?)` collects the range into `bytes` (plus the same metadata). `DownloadedFile` extends the new `DownloadResult`; `DownloadOptions` is exported too, and a `pendingDownloads` getter reports held stream ids.
- Options `offset`, `length`, `ifUnchanged`, `signal`, `onProgress(received, length)`. The stream id is registered before the request is sent (the response now precedes `Begin`); dispatch stays synchronous and in order.
- Feature gate: without `fileDownloadRanges` both reject before sending anything, naming the feature and telling the user to update the daemon.
- Abort rejects at once with `AbortError` and sends `file_download_cancel_request`. **Deviation:** the stream id stays registered until a terminal frame, a refused request, or a `not_found` cancel, so a late `Error cancelled` cannot reach a download that reused the id (accepted by the orchestrator; spec § downloadTo updated).
- A throwing sink or `onProgress` aborts the same way; an `End` short of the announced length rejects; a closed connection or `stop()` rejects every pending download.
- Deleted the token request, `TokenResponse`, `EXPIRED_TOKEN` and the retry-on-expired path.

## Files created / changed
| File | Change |
|------|--------|
| `packages/client/src/file-transfer-client.ts` | download side rewritten |
| `packages/client/src/file-transfer-client.test.ts` | download tests rewritten (22 tests in the file) |
| `packages/cli/src/file-transfer-sdk-e2e.test.ts` | five real-daemon download cases: whole file, two ranges, abort + resume to matching SHA-256, resume after modification → `changed`, flag advertised |
| `packages/client/AGENTS.md` | new flow documented, retry-on-expired section removed |

## How it satisfies the scope
Follow-ups II § 1.6, § 1.8, § `downloadTo` (SDK), § Resuming and seeking. `packages/client/README.md` has no `FileTransferClient` section; `index.ts` already re-exports the file.

## Build & test results
```
$ npm run build:client && npm run build:cli      success
$ npx vitest run packages/client/src packages/cli/src/file-transfer-sdk-e2e.test.ts
Test Files  12 passed / Tests  234 passed
Wave gate on the combined tree (orchestrator):
$ npm run build; npm run typecheck               success
$ npm test                                       Test Files 270 passed / Tests 3761 passed
$ npm run lint                                   0 errors (warnings only in untouched files)
```

## Acceptance criteria
- [x] `downloadTo` delivers 256 × 32 KiB in order through a discarding sink; `pendingDownloads` is 0 afterwards.
- [x] `onProgress` strictly increasing, ends at `length` (empty range reports `(0, 0)`).
- [x] `download` with `offset`/`length` returns exactly the range plus `totalBytes`, `mtimeMs`, `offset`.
- [x] Abort → `AbortError`, cancel request sent, id reusable (held until the daemon's last frame; 300 aborts prove recycling).
- [x] `not_found`, `changed`, `stream_in_use`, `range_not_satisfiable` reject with their code and leave no pending entry.
- [x] Daemon without `fileDownloadRanges`: both reject with the update message and send nothing.
- [x] `rg "file_download_token|TokenResponse|invalid_or_expired_token|EXPIRED_TOKEN" packages/client` finds nothing.
- [x] End-to-end cases pass against the real dev daemon.

## Follow-ups / TODO(verify)
- Workbench callers (`HtmlViewer`, `browser-files`) use only unchanged fields of `download`; verified by the wave's full typecheck.
