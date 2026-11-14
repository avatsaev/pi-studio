# Task 005 — Host: `files` (upload, save to disk, view URL, picker)

- **Sprint:** sprint-093-workbench-host
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench (host, hooks, files)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Route uploads, save-to-disk and viewer URLs through the host, with today's in-memory behaviour as the browser implementation.

## Context / why
These three paths are where the browser's memory limits bite. A native host will stream to and from disk and serve viewer URLs itself. The workbench must only ever ask the host.

## Scope references
- `swe/architecture/workbench-host-adapter.md` § Member contracts (`files.*`), § View URLs, § Supporting types (`UploadSource`, `ViewableFile`), § Error handling
- `swe/features/file-explorer-transfer.md`
- `packages/workbench/src/hooks/{use-file-transfer.ts,use-file-download.ts,file-transfer-instance.ts,use-file-source.ts,use-file-text.ts}`
- `packages/workbench/src/features/files/{FileExplorer.tsx,FileContextMenu.tsx,BinaryFallbackViewer.tsx,ImageViewer.tsx,VideoViewer.tsx,PdfViewer.tsx,MoleculeViewer.tsx}`

## What to build
- Add `files.upload(dir, source)`, `files.saveToDisk(path)`, `files.openForView(path)` and optional `files.pickUploads()` to the host type, with `UploadSource` and `ViewableFile`.
- Browser host: `upload` is today's path (`FileTransferClient.upload` with the file's bytes); `saveToDisk` is today's download-then-anchor-click; `openForView` downloads, wraps the bytes in a `Blob` and returns an object URL whose `release()` revokes it; `pickUploads` is absent.
- `useFileTransfer` and `useFileDownload` call the host. `useFileDownload` keeps its public shape and caching rules (never refetch behind the caller; release the previous URL when superseded and on unmount).
- The explorer's upload action calls `pickUploads` when the host provides it, otherwise it uses the file input as today. Dropped files are wrapped as `UploadSource`s.
- The browser host needs the live connection to transfer. Give it access through a narrow accessor, not by importing the connection store into the host type.
- Tests with a recording host: upload calls the host and then refreshes the explorer listing; a rejected upload shows in the explorer status line; `saveToDisk` resolving after a cancel shows nothing; a view URL is released when superseded and on unmount.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Streaming or paced uploads (sprint 096).
- In-memory byte reads for text, HTML assets and inline images: they keep calling `FileTransferClient.download` directly and are bounded by existing ceilings.

## Acceptance criteria
- [ ] No workbench source outside the browser host calls `URL.createObjectURL` for a daemon file, creates a download anchor, or reads a `File`'s bytes for upload.
- [ ] In `web-client`: upload by picker and by drop, save to disk, and the image, video, PDF, molecule and binary viewers all work as before.
- [ ] Object URLs are revoked as before (no growth after opening and closing twenty image tabs).
- [ ] All tests pass.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- `npx vitest run packages/workbench/src/hooks packages/workbench/src/features/files`
- Browser check against a production daemon: upload two files, download one, open an image, a video and a PDF.

## Notes
- `UploadSource` is opaque to the workbench: only `name` and optional `size` are read. A native host will put a local path in it.
- Spec TODO(verify): confirm the explorer's drop handler can take sources from the DOM event or from the host without two code paths in the feature; record the answer in the spec.
