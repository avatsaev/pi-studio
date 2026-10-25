# Task 001 — pdf.js dependency, vendor chunk, worker and static data assets

- **Sprint:** sprint-078-pdf-viewer
- **Status:** done
- **Type:** chore
- **Area:** packages/web-client (build)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Make `pdfjs-dist` loadable by a lazy viewer in dev and in production builds: own chunk, bundled
worker, and the four runtime data directories served under `<base>/pdfjs/`.

## Context / why

pdf.js fetches optional data files by URL at runtime (cmaps, standard fonts, wasm decoders, ICC
profiles). When they are missing it misrenders some PDFs instead of failing loudly. Behind both
static servers a missing file is worse still: the SPA fallback answers it with `index.html`.
Separately, `manualChunks`'s catch-all would merge pdf.js into the eager `vendor` chunk. This task
lands the build-side plumbing first, so the viewer task only consumes it.

## Scope references

- `swe/features/pdf-file-preview.md` § pdf.js static data assets, § Bundle placement, § Behavior › Worker
- `packages/web-client/package.json`, `package-lock.json`
- `packages/web-client/vite.config.ts` (`manualChunks`, plugin list; `brandHtmlPlugin` is the existing
  dev-middleware + `generateBundle` emit pattern to mirror)
- `packages/cli/src/web-server.ts` (MIME table, read only — confirm nothing needs adding)

## What to build

- `pdfjs-dist@^6.4.299` under web-client **devDependencies** (not `dependencies`: web-client ships
  only its prebuilt `dist`). Keep the lockfile in sync.
- `manualChunks`: `pdfjs-dist` → `"vendor-pdfjs"`, placed before the catch-all.
- A `pdfjsAssetsPlugin()` in `vite.config.ts`:
  - resolves the `pdfjs-dist` package root through Node module resolution (not a hardcoded
    `node_modules` path, because workspaces hoist);
  - dev: middleware serving `GET /pdfjs/<cmaps|standard_fonts|wasm|iccs>/<file>` from that root, and
    nothing outside those four directories (no traversal);
  - build: emits every file of those directories into `pdfjs/<dir>/…`, excluding `quickjs-eval.*`.
- A small module `features/files/pdfjs-runtime.ts` that owns the pdf.js side of the boundary:
  - lazily creates the module Worker once (`new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url), { type: "module" })`) and sets `GlobalWorkerOptions.workerPort`;
  - exports the four data URLs, built from `import.meta.env.BASE_URL` resolved against
    `document.baseURI`, each ending in `/`;
  - exports one `loadPdfjs()` async accessor that returns the pdf.js module with the worker
    configured. It is the only import site of `pdfjs-dist` in the app.

## Out of scope

- The viewer component (task-002), registry entry (task-003).

## Acceptance criteria

- [x] `npm run build:web-client` succeeds with no new warnings. `dist/web/pdfjs/` contains
      `cmaps/`, `standard_fonts/`, `wasm/` (no `quickjs-eval.*`) and `iccs/`.
- [x] The pdf.js worker is emitted as a `.js` asset (no `.mjs` file needs serving).
- [x] No `pdfjs-dist` code is in the eager `vendor` chunk (grep the built `vendor-*.js` for a pdf.js
      marker string such as `PDFDocumentProxy`; it appears only in `vendor-pdfjs-*.js`).
- [x] Dev server: `GET /pdfjs/cmaps/<known>.bcmap` → 200 bytes. `GET /pdfjs/../package.json` and
      `GET /pdfjs/build/pdf.mjs` → not served.
- [x] `pdfjs-dist` is under `devDependencies` in `packages/web-client/package.json`.

## Test / verification plan

- Build: `npm run build:web-client`; inspect `dist/web/` and `dist/web/assets/` as above.
- Typecheck: `npm run typecheck`. Lint: `npx oxlint packages/web-client`.
- Manual: dev server + `curl` for the middleware criteria.
- Resolve `swe/features/pdf-file-preview.md` TODO(verify) #1 (Vite build target) from the observed
  build output.

## Notes

- The worker must be a Vite worker entry (`new Worker(new URL(…))` literal form) so Vite bundles it
  and rewrites the URL. A `?url` import would ship the raw `.mjs`, which nginx/older MIME tables may
  serve with the wrong type for a module worker.
