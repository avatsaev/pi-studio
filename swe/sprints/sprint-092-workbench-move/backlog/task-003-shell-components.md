# Task 003 — Shell components, stylesheets and fonts; reduce `web-client` to a shell

- **Sprint:** sprint-092-workbench-move
- **Status:** backlog
- **Type:** refactor
- **Area:** packages/workbench, packages/web-client
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002

## Goal
Give the moved shell its public component names, move the application stylesheet rules and the terminal font, and reduce `web-client/src` to the browser shell.

## Context / why
After task-002 the application runs from the workbench but is still shaped like `web-client` (`App`, `AppProviders`, `WorkspacePage`). The spec defines `Workbench` as provider + boot + shell so a consumer can compose its own layout.

## Scope references
- `swe/architecture/workbench-package.md` § Root entry: components, § Boot sequence, § What moves, § What stays in `web-client`
- `packages/workbench/src/{app.tsx,providers/AppProviders.tsx,routes/WorkspacePage.tsx,routes/WorkspacePage.module.css}`
- `packages/web-client/src/{main.tsx,global.css,theme/fonts.css,assets/fonts/}`
- `packages/workbench/src/lib/drag-guard.ts` and its test (reads the stylesheet that holds the drag-guard rule)

## What to build
- Create `Workbench`, `WorkbenchProvider` (from `AppProviders`), `WorkbenchBoot` (from `app.tsx`'s `Boot`, same hook order, same comment about pane-layout boot preceding the restore hooks) and `WorkspaceShell` (from `WorkspacePage`, with its CSS Module). Delete `app.tsx`, `providers/` and `routes/`.
- Move `theme/fonts.css` and `assets/fonts/` into the workbench as `src/fonts.css` and its font files.
- Move the `body[data-pi-dragging] iframe` rule into a workbench stylesheet imported by the shell, and point `drag-guard.test.ts` at it. Keep the `#root` layout rule in `web-client` in its own small stylesheet: it styles `web-client`'s mount element, not the workbench.
- `web-client/src/main.tsx`: import `ui-library`'s `reset.css`, the workbench fonts stylesheet and its own stylesheet; render `<Workbench />`; keep calling `attachResumeTriggers()` (temporary export, removed in sprint 093 task-004).
- Extend the source aliases (Vite and vitest) so `@av-pi-studio/workbench/fonts.css` resolves to the source file.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Public names other than these four (sprint 094).
- The host adapter (sprint 093).

## Acceptance criteria
- [ ] `packages/web-client/src` contains only `main.tsx`, one stylesheet, `brand/` and type declarations.
- [ ] `Workbench` renders the same tree as before: provider, boot, shell.
- [ ] The boot hooks run in the same order as before the move.
- [ ] The terminal still renders in the bundled font, and the drag guard still blocks iframes during a drag.
- [ ] All tests pass; `npm run build` passes.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- `npx vitest run packages/workbench`
- `npm run build:web-client`
- Browser check in dev: open a terminal tab, drag a tab over an HTML preview.

## Notes
- The alias for the bare package name must not swallow the `/fonts.css` subpath: order or anchor the alias patterns accordingly.
