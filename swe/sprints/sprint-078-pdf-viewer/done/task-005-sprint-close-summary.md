# Task 005 — Sprint close — Summary

- **Sprint:** sprints/sprint-078-pdf-viewer
- **Completed:** 2026-10-25
- **Status:** done

## What was done
Live E2E in dev (Vite + a real production daemon on an isolated `PI_STUDIO_HOME`) and against the
built bundle served by `pi-studio ui` (the CLI's static server); docs brought in line.

## Files changed
`packages/web-client/AGENTS.md` (tech stack, source layout x3, Viewer-disable gate, live-refresh kinds,
new "PDF viewer" invariant), root `AGENTS.md` (tech-stack row, `viewer_settings_*` row ids),
`swe/features/pdf-file-preview.md` (deviations written back, TODO(verify) #1 resolved),
`swe/sprints/PLAN.md`, `swe/MAIN-SCOPE.md`.

## Build & test results
```
$ npm run build      -> success
$ npm run typecheck  -> success
$ npm run lint       -> 0 errors (warnings pre-existing; the one I introduced was fixed)
$ npm test           -> 225 files, 3071 tests passed
$ npm run fmt:check  -> 25 files flagged, NONE of them touched by this sprint (pre-existing, e.g. lib/paths.ts)
Built bundle via `node packages/cli/dist/cli.js ui --ui-port 5301`:
  opening a PDF lazily fetched PdfViewer-*.js, vendor-pdfjs-*.js (not in index.html), pdf.worker.min-*.js
  (text/javascript) and the file bytes; the canvas rendered. /pdfjs/{cmaps,standard_fonts,wasm,iccs}/…
  -> 200 with the right types; /pdfjs/wasm/quickjs-eval.js -> 404 (excluded). The in-browser asset URLs
  (`PDFJS_ASSET_URLS`) fetched OK for all four directories.
```

## Acceptance criteria
All spec criteria observed (see tasks 001-004 summaries). `detectViewerKind`/`resolveViewerKind` cases
are unit-tested.

## Follow-ups / TODO(verify)
- Open: module Worker under `file://` in the Electron target (the shell is not built).
- Not observed: worker-initiated fetches of cmaps/standard fonts (CDP did not surface them);
  correctness rests on the verified URLs + files, and on the rendered text.
- docker/nginx static serving of `/pdfjs/*` was not run (no container build); it serves arbitrary
  files under `dist` like the CLI server, and `.wasm` is `application/wasm` in nginx's stock types.
