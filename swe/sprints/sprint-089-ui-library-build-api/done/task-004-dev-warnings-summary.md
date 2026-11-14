# Summary — sprint-089 task-004 dev-warnings

## What was built
`theme/dev-warnings.ts`: pure `createDevWarnings(warn)` (once-per-page stylesheet-sentinel check; live-boundary counter, idempotent unregister) + a `@__PURE__` page-wide instance. `src/sentinel.css` (`:root { --piui-stylesheet: 1 }`) is imported from `src/index.ts`, so it lands in `styles.css`. `ThemeBoundary` runs `checkStylesheet` + `registerBoundary` in an effect behind an inline `if (process.env.NODE_ENV === "production") return`. `src/env.d.ts` declares `process` for the package's `types: []`.

## Design finding (changed from the plan)
The planned `isDevelopment()` helper with try/catch did NOT fold away in a consumer's production build: Rollup tree-shakes before esbuild folds the try, so the message strings survived in web-client's bundle. Inlining the bare `process.env.NODE_ENV` comparison in the effect makes Rollup fold it, and the module is then dropped. Consequence: unbundled consumers (raw ESM, no bundler) would hit `ReferenceError: process` in dev; out of scope per D4 (Vite/Electron only), worth one line in the README (s090/task-005).

## Acceptance criteria
- [x] Unit tests: sentinel absent → one warn naming the import; present → none; second registration → one warn; unmount+mount → none; double cleanup does not under-count.
- [x] Production proof: web-client `dist/web` (production build) contains neither warning string (`grep -rl` → 0 JS hits; only the sentinel property remains in CSS); `dist/index.js` of the library still holds a literal `process.env.NODE_ENV`.
- [ ] (Deferred to s090/task-001) browser check that dev warnings stay quiet with a correctly set up app.

## Commands run
`npm run build` ok; `npx vitest run` 258 files / 3532 tests; oxfmt clean.
