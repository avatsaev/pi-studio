# workbench — packaging spike (sprint-091 task-002)

- Date: 2026-11-14, branch `feat/workbench`.
- Purpose: settle `swe/architecture/workbench-package.md` § TODO(verify) packaging questions before
  any application code moves.
- Scratch directories under `/tmp/wb-spike.*`, removed afterwards. Nothing under `packages/` changed.

## Setup

Library `spike-lib` (scratch, `node_modules` symlinked to the repo's):

- `vite.config.ts`: the `ui-library` pattern — `build.lib` with one `index` entry, `formats: ["es"]`,
  `cssCodeSplit: false`, `cssFileName: "styles"`, every `dependencies`/`peerDependencies` name plus
  `react/jsx-runtime` external including deep subpaths, `chunkFileNames: "chunks/[name]-[hash].js"`.
- `dependencies`: `katex`, `mermaid`; `peerDependencies`: `react`, `react-dom`.
- `src/index.tsx`:
  ```tsx
  import "katex/dist/katex.min.css";
  import styles from "./Box.module.css";
  const Local = lazy(() => import("./Local"));
  export const LazySettings = lazy(() => import("./Settings").then((m) => ({ default: m.Settings })));
  export async function renderMermaid() { const { default: m } = await import("mermaid"); return typeof m; }
  export const isDev = process.env.NODE_ENV !== "production";
  export function App() { /* <div className={styles.box}><Suspense><Local/></Suspense></div> */ }
  ```
- First variant: `@font-face` with `url("./fonts/CascadiaMono.woff2")` (the real 210484-byte
  terminal font) inside `Box.module.css`. Second variant: the `@font-face` moved to a plain
  `src/fonts.css`, copied verbatim with `src/fonts/` into `dist/` by a `writeBundle` plugin
  (`cpSync`), exported as `./fonts.css`.
- Built with `packages/ui-library/node_modules/.bin/vite build` (Vite 6.4.6).

Consumer `spike-app`: plain Vite + React + TS, `vite.config.ts` is only `plugins: [react()]`, no
`optimizeDeps`. Installed with
`npm install ../spike-lib-0.0.0.tgz react@19 react-dom@19 vite@^6 @vitejs/plugin-react@^4.7.0 typescript @types/react @types/react-dom`.
`src/main.tsx` imports `spike-lib/styles.css`, `spike-lib/fonts.css`, renders `<App/>` and
`<LazySettings/>`, calls `renderMermaid()`.

## Findings

| # | Question | Observed answer | Evidence |
|---|---|---|---|
| 1 | katex stylesheet inlined (with base64 fonts) into `styles.css`? | **No**, as long as `katex` is a `dependency`: the externals regex matches the deep subpath, so `dist/index.js` keeps a bare `import "katex/dist/katex.min.css";` and `styles.css` holds only the library's own CSS. The consumer's bundler resolves it and emits katex's fonts as files. | Variant 2 `dist/styles.css` = 46 bytes; `head dist/index.js` shows the bare import. Consumer `vite build`: 19 `KaTeX_*.woff2` files in `dist/assets/`. |
| 2 | woff2 inlined? Does verbatim `fonts.css` + font files work? | A font referenced from bundled CSS **is inlined as base64** (Vite library mode ignores `assetsInlineLimit`). The verbatim copy works: consumer import of `spike-lib/fonts.css` resolves the relative `url()`, emits `CascadiaMono-<hash>.woff2`, and the browser loads the face. | Variant 1: `dist/style(s).css` = 280775 bytes, one `url(data:font/woff2;base64,…)`. Variant 2: `dist/fonts.css` 96 B + `dist/fonts/CascadiaMono.woff2` 210484 B; consumer build emits `CascadiaMono-95CNhH_0.woff2`; in the browser `document.fonts` → `Cascadia: loaded`, computed `font-family: Cascadia`. |
| 3 | Local lazy imports separate chunks? External dynamic import kept? | **Yes / yes.** `import("./chunks/Local-<hash>.js")`, `import("./chunks/Settings-<hash>.js")`, and `await import("mermaid")` unchanged. | `dist/index.js` content; consumer build keeps `Local-*.js` and `Settings-*.js` as their own chunks. |
| 4 | Consumer needs `optimizeDeps`? | **No.** The dev server pre-bundles the package (lazy chunks stay separate files in `.vite/deps`), the page renders both lazy components, mermaid loads, no console errors or warnings. | `npx vite --port 5391` + headless browser load: body text `LOCAL_CHUNK_MARKER\nSETTINGS_CHUNK_MARKER`, `__mermaid === "object"`, `errors()` and `console({level:"warn"})` empty. |
| 5 | Lazily loaded component exportable from the entry without merging its chunk? | **Yes.** `export const LazySettings = lazy(() => import("./Settings")…)` keeps `chunks/Settings-<hash>.js` separate in the library and in the consumer build. | As #3. |
| 6 | `process.env.NODE_ENV` left unreplaced? | **Yes, unreplaced** in `dist` (`const m = process.env.NODE_ENV !== "production"`). A Vite consumer replaces it: 0 occurrences in the consumer's production entry chunk. Same behaviour `ui-library` already ships. | `dist/index.js`; `grep -c process.env.NODE_ENV dist/assets/index-*.js` → 0. |

Incidental findings that bind the real build:

- **JSX transform comes from `tsconfig.json`.** Without `"jsx": "react-jsx"` Vite emitted classic
  `React.createElement` calls with no `React` import. The workbench `tsconfig.json` must set
  `react-jsx` (as `ui-library`'s does); the dist assertion should check `react/jsx-runtime` is imported.
- **Use the package-local Vite 6.** The repo root `node_modules/vite` is 5.4.21 (hoisted for another
  dependency); `npx vite` from the root picks it. The workbench must declare `vite` as a
  devDependency and build through its own `npm run build` script, like `ui-library`.
- **Pin the smoke consumer's tooling.** An unpinned `@vitejs/plugin-react` resolves to a version that
  requires a newer Vite (`ERESOLVE`). The smoke script installs `vite@^6` and the repo's
  `@vitejs/plugin-react` range (`^4.7.0`).
- `katex` and every other third-party module the workbench imports **must be a `dependency`** (not a
  devDependency), otherwise it is not external and gets bundled/inlined.

## Decisions

| Question | Approach for sprint 094 |
|---|---|
| katex stylesheet | Keep `import "katex/dist/katex.min.css"` in `timeline/markdown.tsx`; `katex` is a `dependency`, so it stays a bare import. The dist assertion checks `styles.css` has no `data:font` URL. |
| Fonts | `fonts.css` + font files copied verbatim to `dist/` by a build plugin, exported as `./fonts.css`; never referenced from bundled CSS. |
| Lazy chunks | Default Rollup behaviour suffices; assert every baseline `import()` site still appears as a dynamic import in `dist`. |
| Consumer config | None required. README quickstart needs no `optimizeDeps`. |
| `SettingsDialog` export | Export it lazily from the entry (`lazy(() => import(...))`); its chunk stays separate. |
| `process.env.NODE_ENV` | Leave as is (consumer bundler replaces it). Assert no `import.meta.env`, `?worker` or `@web-client/` survives. |
| Smoke-check form | `packages/workbench/scripts/pack-smoke.sh` in the `ui-library` style: pack, install into a scratch app outside the repo with pinned `vite@^6` and `@vitejs/plugin-react@^4.7.0`, then `tsc --noEmit`, `vite build`, and file-level assertions (fonts emitted as files, no base64 fonts, heavy libraries in lazy chunks, deep imports rejected). The run-time check is not scripted (no browser-automation dependency in the repo): `KEEP_DIR=1`, `vite preview`, loaded by hand or by an agent's browser against `npm run dev:daemon`, result recorded in the task summary. This spike used exactly that browser procedure. |
