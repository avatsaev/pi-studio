# Task 002 — Packaging spike: settle the library-build unknowns — Summary

- **Sprint:** sprints/sprint-091-workbench-spike-scaffold
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Built a throwaway Vite 6 library in `/tmp` with the `ui-library` config pattern (CSS Module, katex stylesheet import, local lazy imports, lazily exported component, external `import("mermaid")`, a real woff2 in `@font-face`, `process.env.NODE_ENV`), packed it, installed it into a plain Vite + React + TS consumer, ran a production build and the dev server, and loaded the dev page in a headless browser. Wrote the findings and per-question decisions to `swe/notes/workbench-packaging-spike.md`; resolved four of the five spec `TODO(verify)` items; amended sprint 094 task-001/002 notes.

## Files created / changed
| File | Change |
|------|--------|
| `swe/notes/workbench-packaging-spike.md` | created |
| `swe/architecture/workbench-package.md` | TODO(verify) resolved (region names remain open) |
| `swe/sprints/sprint-094-workbench-build-api/backlog/task-001-library-build.md` | notes amended (katex, Vite 6, react-jsx) |
| `swe/sprints/sprint-094-workbench-build-api/backlog/task-002-public-api.md` | notes amended (SettingsDialog answer) |
| `docs/desktop-client-handoff.md` | consumer bundler constraint updated |

## How it satisfies the scope
All six spike questions answered by observation; the smoke-check form is decided (script with file-level assertions + recorded browser run, since the repo has no browser-automation dependency). Extra constraints found: CSS-referenced assets are inlined as base64 in library mode; `tsconfig` must set `react-jsx`; the root `vite` is 5.4.21 so the package must build with its own Vite 6; smoke consumer must pin `@vitejs/plugin-react@^4.7.0`.

## Build & test results
```
$ packages/ui-library/node_modules/.bin/vite build      (spike lib, variant 1: font in CSS Module)
dist/styles.css 280.78 kB  (base64 woff2 inlined)
$ ... (variant 2: verbatim fonts.css + fonts/ copy)
dist/styles.css 0.05 kB, dist/fonts.css 96 B, dist/fonts/CascadiaMono.woff2 210484 B,
dist/chunks/Local-*.js, dist/chunks/Settings-*.js; index.js keeps import "katex/dist/katex.min.css" and import("mermaid")

$ npm install ../spike-lib-0.0.0.tgz react@19 react-dom@19 vite@^6 @vitejs/plugin-react@^4.7.0 ...   (consumer)
added 187 packages
$ npx vite build
✓ built in 11.80s — 19 KaTeX_*.woff2, CascadiaMono-*.woff2, Local-*/Settings-* chunks; process.env.NODE_ENV: 0 occurrences

$ npx vite --port 5391  + headless browser
body: LOCAL_CHUNK_MARKER / SETTINGS_CHUNK_MARKER; mermaid loaded; Cascadia font 'loaded'; errors: [], warnings: []
```

## Acceptance criteria
- [x] Each of the six questions has an observed answer backed by output in the note.
- [x] The smoke-check form is decided and recorded.
- [x] The spec's packaging `TODO(verify)` items are resolved; region names remain open (task 094-002).
- [x] Scratch directories removed (`/tmp/wb-spike.*`, dev server stopped).
- [x] `docs/desktop-client-handoff.md`: the "needs a bundler" constraint now names Vite 6 + plugin-react 4 and states that no `optimizeDeps` is needed (spike evidence).

## Follow-ups / TODO(verify)
- TypeScript declarations were not part of the spike (consumer `tsc` failed only for the missing `.d.ts`); sprint 094 task-001 emits them with `tsc`, as `ui-library` does.
