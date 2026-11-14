# Task 005 — Browser host: upload without reading the file into memory — Summary

- **Sprint:** sprints/sprint-096-desktop-protocol-followups
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
`HostFiles.upload(dir, source, options?)` gained optional `UploadOptions.onProgress(sent, total?)`. The browser host passes the `File` itself to `FileTransferClient.upload` (no arrayBuffer()), `useFileTransfer`/`uploadAndRefresh` forward the options, and the explorer's `uploadSources` shows `Uploading N files… <percent>%` over the whole batch (only when every size is known; the status text changes only when the percent does). Host spec row, workbench README/AGENTS and the handoff doc updated; the stale AGENTS claim that the dev daemon has no transfer/terminal handlers was corrected.

## Files created / changed
| File | Change |
|------|--------|
| `packages/workbench/src/host/{types,browser-files}.ts` | UploadOptions; Blob passed through |
| `packages/workbench/src/hooks/use-file-transfer.ts` | forward options |
| `packages/workbench/src/features/files/upload-sources.ts` | batchPercent + progress status |
| `packages/workbench/src/host/files.test.ts` | 3 new tests |

## How it satisfies the scope
Cancel (`signal`) was NOT added to the host contract: the explorer has no cancel control, so it would be unused API. The SDK supports it for hosts that want it.

## Build & test results
```
vitest packages/workbench: 116 files / 1494 tests pass; tsc -b clean; oxlint: only pre-existing warnings. LIVE (isolated production daemon :6790, built web-client dist, managed Chromium): uploaded a 600 MiB random file through the Files explorer's Upload input in ~4.7 s; status line went 10%…97% then `Uploaded 1 file`; JS heap 14-19 MB throughout; SHA-256 of source and uploaded file identical (690e44c1…); big.bin appeared in the tree. Renderer RSS rose from ~182 MB to ~860 MB right after the upload and dropped to ~198 MB after a forced GC (HeapProfiler.collectGarbage), i.e. transient slice garbage, not retained file data. Daemon/static server stopped, 600 MB files removed.
```

## Acceptance criteria
['600 MB upload completes, file in tree, memory does not grow by the file size: met (retained memory; RSS climbs transiently until GC).', "Failed upload shows the daemon's error: met by unit test (`Upload failed: <reason>`; SDK rejects with the daemon's `<stage>_failed (<errno>)`). Not provoked live in the browser.", 'Small uploads behave as before: met (existing upload tests pass; the 4 byte-array calls in the SDK suite).', 'Handoff doc: updated.']

## Follow-ups / TODO(verify)
- Cancel button/signal not exposed in the explorer.
- A live browser failure case (e.g. read-only target) was not run.
