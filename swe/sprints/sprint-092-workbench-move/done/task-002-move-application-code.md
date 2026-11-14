# Task 002 — Move the application code and its tests into the workbench

- **Sprint:** sprint-092-workbench-move
- **Status:** done
- **Type:** refactor
- **Area:** packages/workbench, packages/web-client
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Move the application directories from `web-client` to the workbench with `git mv`, and move their dependencies with them.

## Context / why
This is the extraction itself. `web-client` keeps compiling the workbench from source through the alias, so the Vite-only constructs in the moved code (`define` constants, `?worker`, `import.meta.env`) keep working unchanged; sprint 093 removes them through the host.

## Scope references
- `swe/architecture/workbench-package.md` § What moves, § What stays in `web-client`, § Package
- `packages/web-client/src/{features,stores,hooks,timeline,lib,viewer-plugins,test,providers,routes}/`, `app.tsx`, `design-tokens.test.ts`, `css-modules.d.ts`, `vite-env.d.ts`
- `packages/web-client/package.json` (dependency list)
- `packages/workbench/{package.json,src/index.ts}`

## What to build
- `git mv` into `packages/workbench/src/`, keeping paths: `features/`, `stores/`, `hooks/`, `timeline/`, `lib/`, `viewer-plugins/`, `test/`, `providers/`, `routes/`, `app.tsx`, `design-tokens.test.ts`.
- Give the workbench the ambient declarations the moved code needs (`*.module.css`, `*?worker`, `ImportMeta.env.BASE_URL`, `__APP_VERSION__`, `__BRAND_TITLE__`). The last four are temporary and are deleted in sprint 093.
- Export `App` and `attachResumeTriggers` from `packages/workbench/src/index.ts` as temporary exports; `web-client`'s `main.tsx` imports them from `@av-pi-studio/workbench`.
- Move every third-party package the moved code imports from `web-client`'s `devDependencies` to the workbench's `dependencies` (type-only packages to its `devDependencies`). Leave in `web-client` only what its remaining files and `vite.config.ts` import. Drop any package that nothing imports, and name each one in the summary.
- Run `npm install`.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Renaming components or changing any behaviour (task-003).
- The fonts and `global.css` (task-003).
- Host adapter work (sprint 093).

## Acceptance criteria
- [ ] `packages/web-client/src` no longer contains `features/`, `stores/`, `hooks/`, `timeline/`, `lib/`, `viewer-plugins/`, `test/`, `providers/` or `routes/`.
- [ ] `git log --follow` on a moved file shows its history from before the move.
- [ ] The number of test files and tests equals the baseline, and all pass from their new location.
- [ ] `npm run build`, `npm run typecheck` and `npm run lint` pass.
- [ ] The web client's dev server loads and connects to a daemon.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- `npx vitest run packages/workbench packages/web-client`
- `npm run build && npm run typecheck && npm run lint`
- `npm run dev -w packages/web-client`, open the page, connect, send one prompt.

## Notes
- `design-tokens.test.ts` scans the directory it lives in, so after the move it guards the workbench sources. `web-client` keeps almost nothing to scan.
- `react-router` had no importing file at planning time; `framer-motion`, `@floating-ui/react` and some `@radix-ui/*` packages should be checked the same way before they are carried over.
- `tweetnacl` is imported once in the moved code; check whether that import should come from `@av-pi-studio/relay` or `@av-pi-studio/client` instead of being a direct dependency. Report, do not refactor here.
- `web-client` still needs `pdfjs-dist` for its Vite plugin until sprint 093 task-006.
