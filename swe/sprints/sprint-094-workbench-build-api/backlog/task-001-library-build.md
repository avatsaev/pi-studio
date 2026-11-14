# Task 001 — Library build and `dist` assertions

- **Sprint:** sprint-094-workbench-build-api
- **Status:** backlog
- **Type:** feature
- **Area:** packages/workbench (build)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-093

## Goal
Produce the publishable `dist` and a check that proves it has the properties the spec requires.

## Context / why
`web-client` bundles the workbench from source, so nothing exercises the published artefact unless a check does. The properties that matter to a consumer are invisible in a diff: no bundled third-party code, lazy imports still lazy, no inlined binaries, no Vite-only syntax.

## Scope references
- `swe/architecture/workbench-package.md` § Entry points, § Build, § Error handling
- `swe/notes/workbench-packaging-spike.md` (chosen approaches)
- `packages/ui-library/vite.config.ts` (pattern)
- `packages/workbench/{vite.config.ts,package.json,tsconfig.json}`
- `packages/workbench/src/{fonts.css,vite/}`

## What to build
- Library build: ES format; entries for the root and for `./vite`; every dependency and peer external, including deep subpaths; CSS Modules scoped as `piwb-<Component>_<class>_<hash>`; one `styles.css`; declarations from `tsc`.
- Copy `fonts.css` and the font files into `dist` verbatim, with relative URLs that resolve from the published location.
- `package.json` `exports`: `.`, `./styles.css`, `./fonts.css`, `./vite`, `./package.json`, and nothing else.
- A build-time assertion that fails the build when any emitted chunk contains a module from `node_modules` (the dynamic-import preload helper excepted).
- A `check-dist` script that fails when `dist` contains: a base64 font or other large data URL; `?worker`; `import.meta.env`; `__APP_VERSION__`; `__BRAND_TITLE__`; fewer dynamic imports than the sources have. It also lists `dist`'s total size and file count.
- Run `check-dist` as part of the package's `build` script.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Which names the root entry exports (task-002).
- Publishing.

## Acceptance criteria
- [ ] `npm run build:workbench` emits `index.js`, `index.d.ts`, `styles.css`, `fonts.css`, the font files, the `vite` entry and lazy chunks.
- [ ] The build fails if a third-party module is bundled (shown once by temporarily removing an external, then reverted).
- [ ] `check-dist` passes, and fails for each forbidden pattern when one is injected into a copy of `dist`.
- [ ] Every class name in `styles.css` starts with `piwb-`.
- [ ] `web-client` still builds and its `dist/web` size is within 1% of the baseline.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- `npm run build:workbench`
- `node packages/workbench/scripts/check-dist.mjs` (or the name chosen)
- `npm run build:web-client`

## Notes
- Vite's library mode inlines assets regardless of `assetsInlineLimit`, which is why fonts are copied and not imported from a bundled stylesheet.
- Apply the spike's decision for the katex stylesheet here.
