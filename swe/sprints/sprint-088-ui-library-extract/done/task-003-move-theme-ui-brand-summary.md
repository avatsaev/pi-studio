# Summary — sprint-088 task-003 move-theme-ui-brand

## What was built
`git mv`'d into `packages/ui-library/src`: `theme/*` (all but `fonts.css`), `ui/*`, `brand/{config,theme-injection,index}.ts`, `breakpoints.ts` (was `platform/`), `kv-store.ts` (was `providers/`, `localKvStore` → `localStorageKvStore`). Library uses relative imports only. Root `index.ts` re-exports everything; `ui` barrel gained `option-groups`, `theme` barrel gained `TERMINAL_FONT_STACK` (previously deep-imported). web-client: alias `@av-pi-studio/ui-library` → library `src/index.ts` in `vite.config.ts` + root `vitest.config.ts`; `tsconfig.json` project reference (types resolve via the workspace link to `dist/*.d.ts`, like protocol/client); devDependency added; 34 imports across 30 files rewritten by `ast_edit` codemod, 4 duplicate imports merged by hand.
Guard tests moved to `web-client/src/{design-tokens,font-scale}.test.ts`; **interim**: they scan web-client src AND `packages/ui-library/src`, so coverage cannot lapse before s089/task-005 replaces them with the exported checker.
Left in web-client: `brand/build-brand.*`, `theme/fonts.css` (path kept so `main.tsx` and doc comments stay valid).
Scaffold's placeholder `index.test.ts` removed (real tests now live in the library).

## Commands run
- `npx tsc -b` (root) clean; `cd packages/web-client && npx tsc -b` clean
- `npx vitest run` → 257 files, 3522 tests passed
- `npx oxlint packages/ui-library packages/web-client/src` → only pre-existing warnings; `npx oxfmt --check` on changed files clean
- `npm run build` (all packages) ok
- dev smoke: `vite` served `/`, `/src/main.tsx` and the library source via the alias, all HTTP 200 (no browser render check)

## Acceptance criteria
- [x] No listed file remains in web-client except `brand/build-brand.ts`, `theme/fonts.css`.
- [x] No library file imports `@pi-studio-ui`.
- [x] Moved tests pass from `packages/ui-library`; web-client guard tests pass.

## Follow-ups
- The codemod emitted imports without semicolons; `oxfmt` restored them.
- `ThemeBoundary` still requires `store` and `brand` still carries the dead scaffold — intentional, s089.
