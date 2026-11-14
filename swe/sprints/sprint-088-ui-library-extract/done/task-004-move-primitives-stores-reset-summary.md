# Summary — sprint-088 task-004 move-primitives-stores-reset

## What was built
`git mv`'d the 21 primitives (+ `*.module.css`, `useHover`, `helpers`, barrel) to `packages/ui-library/src/primitives/`, and `toast-store`/`announcer-store` (+ tests) to `src/stores/`. Inside the library every import is relative; added `src/css-modules.d.ts`. Library root barrel now exports primitives, `Announcer`, `ToastViewport` and both stores' public API. Generic reset (html/body margin, body background/colour/font, box-sizing, scrollbar) → `packages/ui-library/src/reset.css`; web-client `global.css` keeps only `#root` and the drag-guard iframe rule (`drag-guard.test.ts` still passes). `main.tsx` imports `@av-pi-studio/ui-library/reset.css` (alias entry placed before the package alias, since Vite aliases are prefix matches) then `./global.css`. 120 importer rewrites in 59 files via `ast_edit`; duplicate library imports merged into one statement per file (0 files now import the barrel twice). Removed empty `web-client/src/components/` (+`.gitkeep`).

## Commands run
- `npx tsc -b` + `cd packages/web-client && npx tsc -b` clean
- `npx vitest run` → 257 files / 3522 tests passed (same totals as before the move)
- `npx oxlint packages/ui-library packages/web-client/src` → warnings only (pre-existing, incl. moved files); `npx oxfmt` applied to changed files
- `npm run build` ok; web-client `dist/web` = 26529752 B vs baseline 26532061 B (−0.009%)
- dev smoke: vite served `/src/main.tsx` and `reset.css` via the alias (HTTP 200); no browser render check (manual visual parity is the engineer's gate, D34)

## Acceptance criteria
- [x] No primitive / toast-store / announcer-store file in web-client. [x] `global.css` holds only app-specific rules. [x] Toast + announcer store tests pass from the library; web-client consumers rewritten (toasts/announcements exercised by existing store/e2e tests; no browser interaction).

## Follow-ups
- Interim guard tests scan both packages until s089/t005. `ThemeBoundary.store` still required (s089/t002).
