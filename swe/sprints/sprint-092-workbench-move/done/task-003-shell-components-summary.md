# Task 003 — Shell components, stylesheets and fonts; reduce `web-client` to a shell — Summary

- **Sprint:** sprints/sprint-092-workbench-move
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Moved (`git mv`) `app.tsx` → `shell/WorkbenchBoot.tsx` (now the `WorkbenchBoot` component, same hook order and pane-layout comment), `providers/AppProviders.tsx` → `shell/WorkbenchProvider.tsx`, `routes/WorkspacePage.tsx` + `.module.css` → `shell/WorkspaceShell.tsx` + `.module.css`; added `shell/Workbench.tsx` = provider + boot + shell. `theme/fonts.css` + `assets/fonts/*` moved to the workbench as `src/fonts.css` + `src/fonts/` (urls updated). The drag-guard rule moved to a new workbench `src/global.css` imported by `WorkbenchProvider` (so a custom layout gets it too); `drag-guard.test.ts` points at it again. web-client keeps `#root` in its `global.css`; `main.tsx` imports `@av-pi-studio/workbench/fonts.css`, `reset.css`, `./global.css`, renders `<Workbench />` and still calls `attachResumeTriggers()`. Aliases for `@av-pi-studio/workbench/fonts.css` (specific key first) in web-client Vite and root vitest; `exports["./fonts.css"]` added to the workbench manifest. Deleted `providers/`, `routes/` (incl. a stray tracked `routes/.gitkeep`) and web-client's `theme/`, `assets/`.

## Files created / changed
| File | Change |
|------|--------|
| `packages/workbench/src/shell/{Workbench,WorkbenchBoot,WorkbenchProvider,WorkspaceShell}.tsx, WorkspaceShell.module.css` | moved/created |
| `packages/workbench/src/{fonts.css,fonts/,global.css}` | moved/created |
| `packages/workbench/src/index.ts` | exports shell components |
| `packages/workbench/src/lib/drag-guard.test.ts` | path back to ../global.css |
| `packages/workbench/src/features/terminal/terminal-font.ts` | comment paths |
| `packages/workbench/package.json` | exports ./fonts.css |
| `packages/web-client/src/{main.tsx,global.css}` | shell only |
| `packages/web-client/vite.config.ts, vitest.config.ts` | fonts.css alias |
| `packages/web-client/{AGENTS.md,README.md}, packages/workbench/AGENTS.md` | docs |

## How it satisfies the scope
`workbench-package.md` § Root entry: components (`Workbench` is exactly provider + boot + shell), § Boot sequence (order unchanged), § What moves (fonts, application rules). `web-client/src` is now `main.tsx`, `global.css`, `brand/`, `css-modules.d.ts`.

## Build & test results
```
$ npm run build        -> OK; dist/web 26530220 B (= baseline); CascadiaMono-*.woff2 + CascadiaMonoNF-*.woff2 emitted
$ npm run typecheck    -> OK
$ npx oxlint           -> exit 0
$ npx oxfmt --check <changed/new files> -> clean
$ npx vitest run packages/workbench packages/web-client
Test Files 109 passed (109) / Tests 1453 passed (1453)

Browser (vite dev :5394, headless):
- Against the dev daemon: renders the full shell, connects (task-002 flow).
- Against the production daemon :6767 (dev daemon has no terminal handlers): New tab → New terminal;
  both Cascadia Mono NF faces report `loaded`, prompt icons render; terminal tab closed afterwards.
- Drag guard: an iframe's computed pointer-events is `none` with body[data-pi-dragging], `auto` without.
```

## Acceptance criteria
- [x] `packages/web-client/src` contains only `main.tsx`, one stylesheet, `brand/` and type declarations.
- [x] `Workbench` renders provider, boot, shell (same tree as `App`).
- [x] Boot hooks run in the same order (code moved verbatim; comment kept).
- [x] Terminal renders in the bundled font; drag guard rule active (computed-style check).
- [x] All tests pass; `npm run build` passes.
- [x] `docs/desktop-client-handoff.md`: nothing affected (it does not name the shell files or fonts; component names it uses are the spec's).

## Follow-ups / TODO(verify)
- A real drag of a tab over an HTML preview was not performed; the rule's effect was verified through computed style, and `drag-guard.test.ts` pins the attribute/rule pair.
