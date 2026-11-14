# Task 005 — Host: `files` (upload, save to disk, view URL, picker) — Summary

- **Sprint:** sprints/sprint-093-workbench-host
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Host gained `files: { upload(dir, source), saveToDisk(path), openForView(path) → ViewableFile, pickUploads?() }` plus `UploadSource {name, size?}` and `ViewableFile {url, mimeType?, fileName?, release()}`. Browser implementation `host/browser-files.ts` (today's in-memory paths; idempotent release), reaching the connection only through the new `lib/connection/live-file-transfer.ts` `currentFileTransfer()` accessor. Call sites:
- `useFileTransfer` → `uploadAndRefresh` (host upload, then explorer invalidation) and host `saveToDisk`.
- `useFileDownload` keeps its shape (`objectUrl`, `mimeType`, `fileName`, + internal `release`) and caching rules; it releases through `supersedeDownload` and on unmount.
- `lib/inline-image-cache.ts` / `useInlineImage` open view URLs through the host (injected `open`), releasing on LRU eviction/clear as before.
- Every in-memory download *link* was replaced by a new `SaveFileButton` (host `saveToDisk`): Binary fallback, and the too-large state of Text/Markdown/HTML viewers; the PDF toolbar's download calls `saveToDisk` too (failures alerted through the host). This made the "download tier" of `text-viewer-state.ts`/`use-file-source.ts` obsolete, so it was removed (inputs, `downloading/downloadUrl/downloadName`, `requestDownload`) along with its test case.
- Explorer: upload flow extracted to `features/files/upload-sources.ts` (`uploadSources`), fed by the file input, a drop, or `files.pickUploads()` when the host has one.

## Files created / changed
| File | Change |
|------|--------|
| `packages/workbench/src/host/{types,browser-host}.ts` | files member + types |
| `packages/workbench/src/host/browser-files.ts` | created |
| `packages/workbench/src/host/files.test.ts` | created (6 tests) |
| `packages/workbench/src/lib/connection/live-file-transfer.ts` | created |
| `packages/workbench/src/hooks/{use-file-transfer,use-file-download,use-file-source,use-inline-image}.ts` | through the host |
| `packages/workbench/src/lib/inline-image-cache.ts` | view URLs from the host |
| `packages/workbench/src/features/files/{SaveFileButton.tsx,upload-sources.ts}` | created |
| `packages/workbench/src/features/files/{BinaryFallbackViewer,TextViewer,MarkdownFileViewer,HtmlViewer,PdfViewer,FileExplorer}.tsx` | host save/upload |
| `packages/workbench/src/features/files/text-viewer-state{,.test}.ts` | download tier removed |
| `packages/workbench/src/{hooks/use-inline-image.test.ts,lib/inline-image-cache.test.ts}` | fakes return view files |
| `packages/workbench/src/test/test-host.ts` | files scripting |
| `swe/architecture/workbench-host-adapter.md` | two TODO(verify) resolved |
| `packages/{workbench,web-client}/AGENTS.md, docs/desktop-client-handoff.md` | docs |

## How it satisfies the scope
`workbench-host-adapter.md` § `files.*`, § View URLs, § Supporting types. Spec TODO(verify) on drop sources answered: one upload path (`uploadSources`); a native host that receives drops outside the DOM will need one host-to-workbench signal into it later. Deviation from the task's out-of-scope note: inline chat images now go through `openForView` too, because the acceptance criterion forbids object URLs for daemon files outside the host; they keep their own LRU retention.

## Build & test results
```
$ rg "createObjectURL|document.createElement(\"a\")|download={" packages/workbench/src -g '!*.test.*' (outside host/browser-*)
none (PdfViewer's fetch(url).arrayBuffer() reads its view URL, not a File)
$ npx vitest run packages/workbench/src/host packages/workbench/src/hooks packages/workbench/src/features/files packages/workbench/src/lib
42 files / 433 tests passed
$ npm run build -> OK; typecheck -> OK; oxlint -> exit 0; oxfmt --check changed files -> clean
$ npx vitest run packages/workbench packages/web-client -> 114 files / 1483 tests passed

Browser (vite dev :5394, production daemon :6767, workspace /tmp/wb-files):
- viewers: PNG (blob: URL, natural width 20), MP4 (readyState 4, 1280 wide), PDF (rendered), 54 MB text -> too-large + Download, .zip -> binary fallback + Download; zero <a download> elements in the DOM;
- save to disk via explorer menu, binary viewer, too-large text and PDF toolbar -> 4 host anchor clicks recorded (water.cif, blob.zip, big.txt, sample.pdf);
- upload: picker with two files -> "Uploaded 2 files"; synthetic drop of one File -> "Uploaded 1 file"; all three files on disk with the right bytes;
- 20 image tabs opened and closed -> 20 object URLs created, 20 revoked (no growth);
- molecule viewer: on an isolated production daemon (127.0.0.1:6791, own PI_STUDIO_HOME — the main daemon has molviewer disabled by the user) water.cif rendered (3 atoms, 2 bonds), no page errors.
```

## Acceptance criteria
- [x] No workbench source outside the browser host calls `URL.createObjectURL` for a daemon file, creates a download anchor, or reads a `File`'s bytes for upload.
- [x] Upload by picker and by drop, save to disk, and the image, video, PDF, molecule and binary viewers work (browser check above).
- [x] Object URLs released as before (20/20).
- [x] All tests pass.
- [x] `docs/desktop-client-handoff.md`: host section documents `files`; inventory row marked moved; the memory table names the browser host's methods.

## Follow-ups / TODO(verify)
- UX change: "Download" on a too-large text file or an unpreviewable binary now saves in one step (was: Download, wait, then a "Save file" link).
- "`saveToDisk` resolving after a cancel shows nothing" is guarded in `SaveFileButton` by a mounted ref but not unit-tested (no DOM test environment in this package).
- Two scratch workspaces (`/tmp/wb-files` on the production daemon, plus the isolated daemon's home in /tmp) remain; removed at sprint close.
