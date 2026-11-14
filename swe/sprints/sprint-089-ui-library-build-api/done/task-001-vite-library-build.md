# Task 001 — Vite library-mode build: ESM entries, `styles.css`, `reset.css`, `.d.ts`, `exports`

- **Sprint:** sprint-089-ui-library-build-api
- **Status:** done
- **Type:** feature
- **Area:** packages/ui-library build
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-088 (all)

## Goal
`npm run build:ui-library` emits a self-contained, published-ready `dist`: ESM JS per entry, one prebuilt `styles.css` with prefixed scoped class names, `reset.css`, and declarations, all reachable only through `exports`.

## Context / why
D10 (single prebuilt `styles.css`), D11 (`reset.css`), D12 (root + `/theme` `/ui` `/brand` `/breakpoints` subpaths), D19 (Vite lib mode + `tsc` declarations), D26 (prefix), D29 (`sideEffects`), D30 (`exports` blocks deep imports). Planning-time decision (brief open question, owner scope): scoped name pattern `piui-[name]_[local]_[hash:base64:5]`-style with the fixed `piui-` prefix.

## Scope references
- `swe/grills/ui-library.md` D10–D12, D19, D26, D29, D30; AC1
- `packages/web-client/vite.config.ts` (reference only)
- `packages/ui-library/package.json`, new `packages/ui-library/vite.config.ts`

## What to build
- Entries: `src/index.ts`, `src/theme/index.ts`, `src/ui/index.ts`, `src/brand/index.ts`, `src/breakpoints.ts`. Subpath entries `/theme`, `/ui`, `/brand`, `/breakpoints` must not import React-bearing modules — move `ThemeBoundary` out of the `/theme` barrel into the root barrel only (it stays exported from root).
- Externalize `react`, `react/jsx-runtime`, `react-dom`, and every `dependencies` entry (deep subpaths included).
- `build.cssCodeSplit: false` → one `styles.css`; `css.modules.generateScopedName` with the `piui-` prefix. Emit `reset.css` as a separate untransformed asset.
- Declarations: `tsc -b` emitting `.d.ts` into `dist` (keep in root graph).
- `package.json` `exports`: `.`, `./theme`, `./ui`, `./brand`, `./breakpoints` (each `types` + `import`), `./styles.css`, `./reset.css`; nothing else. `build` script = vite + tsc; root `build:ui-library` uses it.
- web-client switches `main.tsx` to `import "@av-pi-studio/ui-library/reset.css"` and its Vite alias maps that specifier to the source file (dev keeps HMR, D19). web-client keeps compiling library CSS modules from source.

## Out of scope
- API changes (t002–t004); gallery/pack smoke (s090).

## Acceptance criteria
- [x] AC1: `dist` holds ESM for every entry, `.d.ts` for every entry, `styles.css` (all primitive classes, all prefixed `piui-`) and `reset.css`.
- [x] Importing `@av-pi-studio/ui-library/theme` from a Node script pulls no `react` (check the emitted `dist/theme` graph).
- [x] `dist` JS contains no `@pi-studio-ui`/`@web-client` specifiers and no inlined React.

## Test / verification plan
- Build: `npm run build:web-client` (and `npm run build` at sprint end) succeeds.
- Typecheck/Lint: `npm run typecheck`, `npm run lint`, `npx oxfmt --check <changed files>` clean.
- Tests: `npm test` green.
- `node -e "import('@av-pi-studio/ui-library/theme').then(m=>console.log(Object.keys(m).length))"` from repo root succeeds (resolved via workspace link).
- Inspect `dist/styles.css`: `rg -c '\.piui-' dist/styles.css` > 0 and no unprefixed module class.

## Notes
TODO(verify): Vite library mode and `process.env.NODE_ENV` — t004's dev-only warnings must **survive** into `dist` unreplaced so the consumer's bundler decides. Confirm here that lib-mode ES output leaves `process.env.NODE_ENV` untouched (set `define` explicitly if not).
