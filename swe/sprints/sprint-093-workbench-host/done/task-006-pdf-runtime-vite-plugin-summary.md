# Task 006 — Host: `pdf` runtime, and the pdf.js Vite plugin as a package export — Summary

- **Sprint:** sprints/sprint-093-workbench-host
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Host gained optional `pdf: HostPdf { createWorker(): Worker; assetBaseUrl: string }` (exported type). `features/files/pdfjs-runtime.ts` now takes the worker (created once) and the data base URL from `getHost().pdf`; `pdfjsAssetUrls(base, documentBase)` is pure (trailing slash optional); without `host.pdf` it throws `PdfUnavailableError`, which `PdfViewer` classifies as a new `unavailable` failure ("PDF preview is not available in this application." + Download). `pdfjsAssetsPlugin` moved from `web-client/vite.config.ts` to `packages/workbench/vite/pdfjs-assets.ts` (outside `src`, so Node types never reach the UI sources), now typed structurally (`PdfjsAssetsPlugin`) instead of importing Vite's `Plugin`, and with the `noUncheckedIndexedAccess` errors it had in web-client fixed. `web-client`: `vite.config.ts` imports the plugin by relative source path; `main.tsx` imports the worker with `?worker` and passes `pdf` to `createBrowserHost`; its `vite-env.d.ts` references `vite/client`. The workbench's `src/vite-env.d.ts` is deleted.

## Files created / changed
| File | Change |
|------|--------|
| `packages/workbench/src/host/{types,browser-host}.ts, src/index.ts` | pdf member, option, HostPdf export |
| `packages/workbench/src/features/files/{pdfjs-runtime.ts,PdfViewer.tsx}` | host-driven runtime, unavailable state |
| `packages/workbench/vite/pdfjs-assets.ts` | created (moved plugin) |
| `packages/workbench/src/host/pdf.test.ts` | created (4 tests incl. pdfjs-dist range pin) |
| `packages/workbench/src/vite-env.d.ts` | deleted |
| `packages/web-client/{vite.config.ts,src/main.tsx,src/vite-env.d.ts}` | plugin import, worker + pdf option, vite/client |
| `packages/{workbench,web-client}/AGENTS.md, docs/desktop-client-handoff.md` | docs |

## How it satisfies the scope
`workbench-host-adapter.md` § `pdf`, § pdf.js; `workbench-package.md` § Entry points (`./vite` source exists; building it into `dist` + `exports` is sprint 094 task-001, as scoped).

Import choice (task note): **relative source path** (`../workbench/vite/pdfjs-assets.js`). `vite.config.ts` is loaded by Node, where the source alias does not apply, and the built `./vite` entry does not exist until sprint 094 — and even then web-client stays on sources like everything else, while the pack smoke proves the published entry.

The plugin is typed structurally rather than against `vite`'s `Plugin`: in the monorepo, web-client (Vite 6.4.3) and the workbench (6.4.6) have separate Vite copies whose types TypeScript treats as distinct (aligning the lock to one version did not help — distinct install paths; reverted). The structural type also means a published consumer needs no particular Vite for the types.

## Build & test results
```
$ rg "\?worker|import\.meta\.env" packages/workbench/src -> none
$ npx vitest run packages/workbench/src/host/pdf.test.ts packages/workbench/src/features/files -> 12 files / 196 tests passed
$ npm run build -> OK; dist/web/pdfjs/{cmaps,iccs,standard_fonts,wasm}, 198 files (= before)
$ npm run typecheck -> OK; oxlint -> exit 0; oxfmt --check changed files -> clean
$ npx vitest run packages/workbench packages/web-client -> 115 files / 1487 tests passed
$ npx tsc -p packages/web-client/tsconfig.node.json -> 1 error (HEAD: 5); the remaining TS2769 is @vitejs/plugin-react typed against the root Vite 5 copy, pre-existing and unrelated

Dev serving: /pdfjs/cmaps/<file> 200, /pdfjs/wasm/openjpeg.wasm 200 application/wasm, a traversal attempt falls through to the SPA.
Browser (production daemon :6767): sample.pdf renders, text layer contains "Parity PDF", zoom in -> 300%.
With `pdf` temporarily removed from main.tsx: the PDF tab shows "PDF preview is not available in this application." + Download; other tabs (image, text) keep working; no page errors other than Chrome's own media range-retry on the open video tab.
```

## Acceptance criteria
- [x] No workbench source contains `?worker` or `import.meta.env`.
- [x] PDFs render as before, including text selection layer and zoom.
- [x] With `host.pdf` removed, opening a PDF shows the error state and nothing else breaks.
- [x] Data directories served in dev and emitted under `dist/web/pdfjs/` (198 files).
- [x] All tests pass.
- [x] `docs/desktop-client-handoff.md`: host paragraph documents the optional `pdf` member and the same-version requirement.

## Follow-ups / TODO(verify)
- `packages/web-client/tsconfig.node.json` is not run by any gate and still has one pre-existing error (plugin-react vs root Vite 5 types). Left alone; out of scope.
