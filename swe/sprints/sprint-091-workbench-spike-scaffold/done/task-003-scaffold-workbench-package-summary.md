# Task 003 — Scaffold `packages/workbench` and wire it into the workspace — Summary

- **Sprint:** sprints/sprint-091-workbench-spike-scaffold
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Created `@av-pi-studio/workbench` 0.0.117: package manifest (exports `.` + `./package.json`, `sideEffects` CSS, peers React 19, deps protocol/client/ui-library `^0.0.117`), declarations-only `tsconfig.json` (`react-jsx`, references), Vite 6 library config per the spike (externals incl. deep subpaths, `piwb-` scoped CSS Modules, single `styles.css`), placeholder entry `WORKBENCH_PACKAGE_NAME` and one test. Wired into the root workspaces, `build:workbench` (in `build` after `build:ui-library`), root tsconfig references and the vitest alias; web-client got the devDependency, Vite alias and tsconfig reference. Lockfile updated by `npm install`. Docs: new `packages/workbench/AGENTS.md`; root AGENTS.md layout, dependency graph and index; web-client AGENTS.md dependency graph.

## Files created / changed
| File | Change |
|------|--------|
| `packages/workbench/{package.json,tsconfig.json,vite.config.ts}` | created |
| `packages/workbench/src/index.ts, src/index.test.ts` | created |
| `packages/workbench/AGENTS.md` | created |
| `package.json` | workspace, build:workbench, build chain |
| `tsconfig.json` | reference |
| `vitest.config.ts` | alias |
| `packages/web-client/{package.json,vite.config.ts,tsconfig.json}` | devDependency, alias, reference |
| `package-lock.json` | workspace link |
| `AGENTS.md, packages/web-client/AGENTS.md` | docs |

## How it satisfies the scope
`workbench-package.md` § Package / § Development workflow: built like ui-library, consumed by web-client from source via alias. Not added to `scripts/publish.sh` or the Dockerfile (sprint 095), as the task requires.

## Build & test results
```
$ npm install
(workspace link added; npm ls shows @av-pi-studio/workbench@0.0.117 -> ./packages/workbench, deduped under web-client)

$ npm run build:workbench
dist/index.js 0.08 kB; dist/index.d.ts emitted

$ npm run build          -> OK (all packages, incl. web-client)
$ npm run typecheck      -> OK
$ npm run lint           -> exit 0 (pre-existing warnings only, none in changed files)
$ npx oxfmt --check <changed files> -> clean except packages/web-client/package.json, which fails identically at HEAD (pre-existing, left untouched)
$ npx vitest run         -> 260 files, 3535 tests passed

Placeholder import check (temporary `import { WORKBENCH_PACKAGE_NAME } from "@av-pi-studio/workbench"` in web-client main.tsx, reverted afterwards):
$ npm run build:web-client -> OK; "@av-pi-studio/workbench" string present in dist/web/assets/index-*.js
$ vite dev on :5394 + headless browser -> window.__wb === "@av-pi-studio/workbench"
```

## Acceptance criteria
- [x] `npm run build:workbench` emits `dist/index.js` and `dist/index.d.ts`.
- [x] `npm run build`, `npm run typecheck`, `npm run lint` and `npm test` pass.
- [x] `npm ls @av-pi-studio/workbench` shows the workspace link.
- [x] `web-client` imports the placeholder export in dev and in a production build (temporary import, reverted).
- [x] `docs/desktop-client-handoff.md`: nothing it states changed (the package is still not importable from npm); progress row updated at sprint end.

## Follow-ups / TODO(verify)
- `packages/web-client/package.json` has a pre-existing oxfmt finding on `main`; not reformatted to keep the diff focused.
