# Task 001 — Library build and `dist` assertions — Summary

- **Sprint:** sprints/sprint-094-workbench-build-api
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Workbench build now has two entries — `index` (application) and `vite/index` (Node-side `pdfjsAssetsPlugin`, source renamed from `vite/pdfjs-assets.ts` to `vite/index.ts`; web-client's relative import updated) — with every dependency/peer and `node:*` external including deep subpaths, `piwb-` scoped CSS Modules in one `styles.css`, lazy chunks under `chunks/`. Two build plugins: `noBundledDependencies` (fails the build when a chunk contains a `node_modules` module other than Vite's preload helper) and `copyFonts` (verbatim `fonts.css` + `fonts/`). Declarations: `tsconfig.json` for `src` (now excludes `src/test`) and a new `tsconfig.vite.json` (Node types, `dist/vite`), both built by `tsc -b`; the root `tsconfig.json` references the latter so `npm run typecheck` covers it. `scripts/check-dist.mjs` runs last in `build` (also `npm run check-dist`, optional dir argument). `exports`: `.`, `./styles.css`, `./fonts.css`, `./vite`, `./package.json`. `files` now also drops nested `.tsbuildinfo`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/workbench/vite.config.ts` | two entries, node externals, guard + font-copy plugins |
| `packages/workbench/scripts/check-dist.mjs` | created |
| `packages/workbench/tsconfig.vite.json` | created |
| `packages/workbench/tsconfig.json` | exclude src/test |
| `packages/workbench/package.json` | exports, scripts, files |
| `packages/workbench/vite/index.ts` | renamed from vite/pdfjs-assets.ts |
| `packages/web-client/vite.config.ts` | import path |
| `tsconfig.json` | reference tsconfig.vite.json |
| `packages/{workbench,web-client}/AGENTS.md, docs/desktop-client-handoff.md` | docs |

## How it satisfies the scope
`workbench-package.md` § Entry points, § Build (spike decisions applied: katex stays a bare import, fonts copied, react-jsx).

Acceptance interpretation: "every class name in styles.css starts with piwb-" was tightened to what is achievable and meaningful — three third-party DOM classes (CodeMirror `.cm-theme`/`.cm-editor`, pdf.js `.markedContent`) are styled through `:global()` and cannot be renamed; `check-dist` requires every selector containing a class to be anchored on a `piwb-` class, so nothing in `styles.css` can reach outside the workbench. All classes the workbench defines start with `piwb-`.

## Build & test results
```
$ npm run build:workbench
dist: 504 files, 2.20 MB; dynamic imports 16 (src 16)
check-dist: ok
emitted: index.js, index.d.ts, styles.css, fonts.css, fonts/{CascadiaMono,CascadiaMonoNF}.woff2 + license, vite/index.{js,d.ts}, chunks/ (25)

Bundling guard (temporary config dropping `clsx` from externals):
  Error: [workbench-no-bundled-dependencies] third-party modules were bundled ...
  chunks/index-*.js: .../node_modules/clsx/dist/clsx.mjs   (exit 1; temp config deleted)

check-dist on injected copies of dist (each exit=1):
  font     styles.css: inlined font (data:font/…)
  b64      index.js: large base64 data URL
  worker   index.js: contains ?worker
  metaenv  index.js: contains import.meta.env
  appver   index.js: contains __APP_VERSION__
  brand    index.js: contains __BRAND_TITLE__
  dyn      dynamic imports: 15 in dist < 16 in src (a lazy chunk was merged)
  class    styles.css: selectors not anchored on a piwb- class: .leaky
  clean dist: check-dist: ok

$ npm pack --dry-run -> 270 entries, 1.49 MB packed, no .map / .tsbuildinfo
$ npm run build -> OK; dist/web 26533462 B (baseline 26530220, +0.01%)
$ npm run typecheck -> OK; npm run lint -> exit 0; npm test -> 266 files / 3571 tests passed
```

## Acceptance criteria
- [x] `npm run build:workbench` emits `index.js`, `index.d.ts`, `styles.css`, `fonts.css`, the font files, the `vite` entry and lazy chunks.
- [x] The build fails if a third-party module is bundled (shown with `clsx`, reverted).
- [x] `check-dist` passes, and fails for each forbidden pattern injected into a copy of `dist`.
- [x] Every class name the workbench defines in `styles.css` starts with `piwb-`; third-party classes appear only under a `piwb-` anchor (see interpretation above).
- [x] `web-client` still builds; `dist/web` +0.01% vs baseline.
- [x] `docs/desktop-client-handoff.md`: the pdf paragraph now names the real `@av-pi-studio/workbench/vite` export.

## Follow-ups / TODO(verify)
- None.
