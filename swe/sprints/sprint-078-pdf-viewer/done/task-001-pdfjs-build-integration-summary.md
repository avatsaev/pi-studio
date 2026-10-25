# Task 001 — pdf.js dependency, vendor chunk, worker and static data assets — Summary

- **Sprint:** sprints/sprint-078-pdf-viewer
- **Completed:** 2026-10-25
- **Status:** done

## What was implemented
`pdfjs-dist@^6.4.299` as a web-client devDependency; a `vendor-pdfjs` manual chunk; a
`pdfjsAssetsPlugin` in `vite.config.ts` that serves (dev middleware) and emits (build) the
`cmaps`/`standard_fonts`/`wasm`/`iccs` directories under `<base>/pdfjs/`, excluding
`quickjs-eval.*`; `features/files/pdfjs-runtime.ts`, the app's only `pdfjs-dist` import site (lazy
shared module Worker via Vite's `?worker`, plus the four data URLs resolved against the app base).
`worker.format: "es"` keeps pdf.js's ES-module worker as a module worker.

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/package.json`, `package-lock.json` | `pdfjs-dist` devDependency |
| `packages/web-client/vite.config.ts` | `pdfjsAssetsPlugin`, `vendor-pdfjs` rule, `worker.format` |
| `packages/web-client/src/features/files/pdfjs-runtime.ts` | created |
| `packages/web-client/src/vite-env.d.ts` | `import.meta.env.BASE_URL` and `*?worker` ambient types |

## How it satisfies the scope
Matches spec § pdf.js static data assets and § Bundle placement. Deviation: the worker is imported
with `?worker` (Vite's worker-entry form) instead of the `new Worker(new URL(…))` literal the task
sketched, which is the same bundling mechanism with a typed constructor.

## Build & test results
```
$ npm run build:web-client            # success
dist/web/pdfjs/{cmaps:169,standard_fonts:16,wasm:11 (no quickjs-eval),iccs:2}, 3.6 MB
assets/vendor-pdfjs-*.js 483.79 kB (own chunk), assets/pdf.worker.min-*.js (a .js asset)
grep PDFDocumentProxy dist/web/assets/vendor-*.js -> only vendor-pdfjs
grep -c "vendor-pdfjs" dist/web/index.html -> 0 (not preloaded)
dev server: /pdfjs/cmaps/78-EUC-H.bcmap 200 octet-stream; /pdfjs/wasm/jbig2.wasm 200 application/wasm;
  /pdfjs/wasm/quickjs-eval.js and /pdfjs/build/pdf.mjs -> SPA fallback html, not served;
  path-traversal attempts -> SPA fallback html (614 B), no file content
$ npm run typecheck                    # success
```

## Acceptance criteria
- [x] Build succeeds; `dist/web/pdfjs/` holds the four directories without `quickjs-eval.*`.
- [x] Worker emitted as a `.js` asset.
- [x] No pdf.js in the eager `vendor` chunk.
- [x] Dev middleware serves only the four directories' own files.
- [x] `pdfjs-dist` under `devDependencies`.

## Follow-ups / TODO(verify)
- Spec TODO(verify) #1 (Vite build target): resolved, the production build transforms pdf.js
  with no esbuild errors or new warnings.
