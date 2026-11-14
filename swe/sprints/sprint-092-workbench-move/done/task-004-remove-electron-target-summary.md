# Task 004 — Remove the `electron` build target — Summary

- **Sprint:** sprints/sprint-092-workbench-move
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Removed `build:electron` and the `VITE_TARGET=web` prefixes from `build:web`; `vite.config.ts` lost the target switch, the relative-base branch and the `import.meta.env.VITE_TARGET` define (`base: "/"`, `outDir: "dist/web"`). Comments updated (pdfjs-runtime, vite-env ambient BASE_URL, the `define` comments now point at the workbench's `vite-env.d.ts`). Docs: web-client README + AGENTS (status, desktop paragraph, layout line, usage, brand/sourcemap notes, the obsolete "relative-base safe" and Electron contextBridge invariants), CONTRIBUTING (build command, package tree), `docs/build-layering.md`, `swe/MAIN-SCOPE.md` § Tech stack, and the two architecture specs' build-flag passages (marked superseded). Because web-client now imports the workbench, `docker/web-client.Dockerfile` had to copy `packages/workbench` for the acceptance's Docker build to pass — pulled forward from sprint 095 task-001 (its task file notes this).

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/{package.json,vite.config.ts}` | electron target removed |
| `packages/workbench/src/features/files/pdfjs-runtime.ts, src/vite-env.d.ts` | comments |
| `docker/web-client.Dockerfile` | copies packages/workbench |
| `packages/web-client/{README.md,AGENTS.md}, CONTRIBUTING.md, docs/build-layering.md, swe/MAIN-SCOPE.md, swe/architecture/{client-app-runtime,design-system}.md` | docs |
| `swe/sprints/sprint-095-workbench-release/backlog/task-001-release-wiring.md` | note: Dockerfile part done |

## How it satisfies the scope
`workbench-package.md` § `electron` target removal. `dist/web` path and contents unchanged.

## Build & test results
```
$ rg "VITE_TARGET|build:electron|dist/electron" (outside swe/sprints, swe/grills, swe/notes)
only swe/architecture/workbench-package.md (this change's spec, describing the removal) and the superseded swe/features/desktop-app.md

$ npm run build:web-client   -> OK; dist/ contains only web/; 26530220 B
$ diff <baseline chunk list> <current>   -> identical (657 entries)
$ npx vitest run packages/cli  -> 27 files / 439 tests passed
$ docker build -f docker/web-client.Dockerfile -t pi-studio-web-client:wb-test .  -> exit 0 (image removed afterwards)
$ npm run typecheck -> OK; npx oxlint packages/web-client -> exit 0; oxfmt --check on changed code -> clean
```

## Acceptance criteria
- [x] The rg check finds nothing outside the exempt locations (the workbench spec itself documents the removal; desktop-app.md is superseded).
- [x] `npm run build:web-client` emits `dist/web` with the baseline chunk-name list.
- [x] CLI tests pass; the web-client Docker image builds.
- [x] `docs/desktop-client-handoff.md`: nothing affected (it already states the target is removed as part of 092).

## Follow-ups / TODO(verify)
- None.
