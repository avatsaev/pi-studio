# Task 004 — Move primitives, toast/announcer stores, generic global CSS into ui-library

- **Sprint:** sprint-088-ui-library-extract
- **Status:** done
- **Type:** refactor
- **Area:** packages/ui-library/src, packages/web-client/src
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-003

## Goal
All 21 primitives, `useHover`, `helpers.ts`, the toast and announcer stores and the generic reset CSS live only in ui-library; web-client consumes them unchanged.

## Context / why
D6, D7 (stores move; zustand becomes a library dependency), D11 (reset becomes its own CSS entry), D14 (hosts still mounted explicitly by the app).

## Scope references
- `swe/grills/ui-library.md` D6, D7, D11, D14; § Integration points (global.css row)
- `packages/web-client/src/components/primitives/**`, `stores/toast-store.ts(+test)`, `stores/announcer-store.ts(+test)`, `global.css`
- `packages/web-client/src/lib/drag-guard.ts` + `drag-guard.test.ts` (reads `global.css` by path)
- `packages/web-client/src/routes/WorkspacePage.tsx` (mounts `ToastViewport`/`Announcer`)

## What to build
- `git mv` primitives (+ `*.module.css`) into `packages/ui-library/src/primitives/`; stores into `src/stores/`. Relative imports only inside the library.
- Split `global.css`: html/body reset, body background/colour/font tokens, box-sizing, scrollbar rules → `packages/ui-library/src/reset.css`. `#root` flex and `body[data-pi-dragging] iframe` stay in web-client `global.css` (drag-guard test must still pass).
- web-client `main.tsx` imports the library reset via the alias (source path for now; s089/t001 adds the `./reset.css` export and this import switches to `@av-pi-studio/ui-library/reset.css`). Keep import order: `fonts.css`, reset, app `global.css`.
- Library root barrel exports primitives, `useHover`, helpers, store APIs (`useToastStore`, toast helpers, announcer API) under their existing names.
- Rewrite all web-client imports to `@av-pi-studio/ui-library`; delete the emptied `components/` dir.

## Out of scope
- Alias rename (t005); build output/`styles.css` (s089/t001).

## Acceptance criteria
- [x] No primitive, toast-store or announcer-store file left in web-client.
- [x] web-client `global.css` contains only the app-specific rules.
- [x] Toasts and screen-reader announcements still fire in web-client (existing tests + dev smoke).

## Test / verification plan
- Build: `npm run build:web-client` (and `npm run build` at sprint end) succeeds.
- Typecheck/Lint: `npm run typecheck`, `npm run lint`, `npx oxfmt --check <changed files>` clean.
- Tests: `npm test` green.
- Dev smoke: open a dialog, a menu, trigger a toast (e.g. copy action) in `npm run dev`.
