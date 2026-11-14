# Task 006 — Host: `pdf` runtime, and the pdf.js Vite plugin as a package export

- **Sprint:** sprint-093-workbench-host
- **Status:** done
- **Type:** feature
- **Area:** packages/workbench (host, files, vite), packages/web-client
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Take the pdf.js worker and asset location from the host, and ship the plugin that serves pdf.js data from the workbench.

## Context / why
A `?worker` import and `import.meta.env` cannot survive into a prebuilt library. Only an application can import a worker, so the application passes it in. The plugin that serves pdf.js's data directories lives in `web-client`'s Vite config today; a second consumer needs the same plugin.

## Scope references
- `swe/architecture/workbench-host-adapter.md` § Member contracts (`pdf`), § pdf.js, § Error handling
- `swe/architecture/workbench-package.md` § Entry points (`./vite`)
- `swe/features/pdf-file-preview.md`
- `packages/workbench/src/features/files/{pdfjs-runtime.ts,PdfViewer.tsx}`
- `packages/web-client/vite.config.ts` (`pdfjsAssetsPlugin`, `worker.format`)
- `packages/web-client/src/main.tsx`

## What to build
- Add optional `pdf: { createWorker(): Worker; assetBaseUrl: string }` to the host type.
- `pdfjs-runtime.ts` builds its asset URLs from `host.pdf.assetBaseUrl` and takes its worker from `host.pdf.createWorker()`. With `host.pdf` absent, loading fails with a typed error and the PDF viewer shows its existing error state with the download action.
- Move `pdfjsAssetsPlugin` into the workbench as the `./vite` entry (Node code, typed against Vite's plugin type). It must still match requests against the real directory listing only.
- `web-client`: `vite.config.ts` uses the plugin from the workbench; `main.tsx` imports the worker with `?worker` and passes `pdf` to `createBrowserHost`. Remove the workbench's ambient `*?worker` and `ImportMeta.env` declarations.
- Add a test that fails when `web-client`'s `pdfjs-dist` version range differs from the workbench's: a mismatched worker and API fail at run time.
- Tests: asset URLs derive from the base; absent `pdf` yields the typed error.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Building the `./vite` entry into `dist` and adding it to `exports` (sprint 094 task-001).

## Acceptance criteria
- [ ] No workbench source contains `?worker` or `import.meta.env`.
- [ ] PDFs render in `web-client` exactly as before, including text selection and zoom.
- [ ] With `host.pdf` removed from `web-client`'s host, opening a PDF shows the error state and nothing else breaks.
- [ ] The data directories are still served in dev and emitted under `dist/web/pdfjs/`.
- [ ] All tests pass.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- `npx vitest run packages/workbench/src/features/files`
- `npm run build:web-client && ls packages/web-client/dist/web/pdfjs`
- Browser check: open a PDF; repeat with `pdf` temporarily omitted.

## Notes
- `vite.config.ts` is loaded by Node, where the Vite source alias does not apply: import the plugin by relative source path, or through the package export once it is built. Choose one and say why in the summary.
- The plugin needs Node types; the rest of the workbench is typed without them. Keep them from leaking into the UI sources' type environment.
