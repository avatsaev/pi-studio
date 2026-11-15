# Task 006 — Browser host: build download Blobs from chunks

- **Sprint:** sprint-097-download-ranges
- **Status:** done
- **Type:** refactor
- **Area:** packages/workbench (host)
- **Priority:** P2
- **Estimated size:** XS
- **Depends on:** task-004

## Goal
Saving and viewing a file in the browser no longer copies the whole file into one array before making the `Blob`.

## Context / why
`files.saveToDisk` and `files.openForView` call the SDK's `download`, which concatenates every chunk into one `Uint8Array`, and then copy that into a `Blob`: two to three copies of the file in memory. With `downloadTo` the host can hand the chunks to the `Blob` constructor directly.

## Scope references
- `swe/features/desktop-client-protocol-followups-2.md` § 1.7
- `swe/architecture/workbench-host-adapter.md` (`files`)
- `packages/workbench/src/host/browser-files.ts` (`saveToDisk`, `openForView`, `toBlob`)
- `packages/workbench/src/host/files.test.ts`, `packages/workbench/src/host/host-guard.test.ts`

## What to build
- `saveToDisk` and `openForView` collect the chunks delivered by `FileTransferClient.downloadTo` and build `new Blob(chunks, { type })` from them. File name and MIME type come from the resolved download info.
- Remove `toBlob` if nothing else uses it.
- The `WorkbenchHost` contract (`packages/workbench/src/host/types.ts`) does not change.

Shared documents: `docs/desktop-client-handoff.md` and `swe/features/desktop-client-protocol-followups-2.md` are touched by most tasks of this sprint. Run alone, update what this task makes stale there. In a parallel wave, do not edit them: put the exact changes in the summary and the orchestrator applies them after the wave gate.

## Out of scope
- Download progress in the explorer, range-aware viewers, native file drops: they need new host members and belong to a later scope.
- `packages/workbench/src/features/files/HtmlViewer.tsx`, which calls the SDK's `download` directly because it needs the bytes.

## Acceptance criteria
- [ ] `browser-files.ts` no longer calls `download`; neither function concatenates the file into one array.
- [ ] `saveToDisk` still triggers a download with the daemon's file name, and `openForView` still returns `{ url, mimeType?, fileName?, release() }` with an idempotent `release`.
- [ ] The host tests and the browser-API guard test pass.

## Test / verification plan
- `npx vitest run packages/workbench/src/host`
- `npm run build:workbench`
- `npx oxfmt <changed files>`
- The live browser check (save a file, view an image and a PDF) runs in task-007, in the orchestrator.

## Notes
- The SDK keeps no reference to a chunk after the sink returns; the host keeping them until the `Blob` exists is the intended use.
