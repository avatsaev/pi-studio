# Task 001 — Replace `@web-client/*` with relative imports

- **Sprint:** sprint-092-workbench-move
- **Status:** backlog
- **Type:** refactor
- **Area:** packages/web-client
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-091

## Goal
Convert every `@web-client/*` import to a relative import and delete the alias, while the code is still in `web-client`.

## Context / why
Emitted type declarations keep path-alias specifiers, which a consumer of the published package cannot resolve. `ui-library` uses relative imports only for this reason. Doing the conversion before the move means the move itself is a pure `git mv`: relative paths between the moved directories do not change.

## Scope references
- `swe/architecture/workbench-package.md` § Imports inside the package
- `packages/web-client/src/**` (452 imports in 151 files, tests included)
- `packages/web-client/vite.config.ts`, `packages/web-client/tsconfig.json` (`paths`), `vitest.config.ts` (alias)

## What to build
- Rewrite every static import, dynamic `import()`, `export … from`, and every module-specifier string passed to `vi.mock`, `vi.doMock` or `vi.importActual` from `@web-client/<path>` to the equivalent relative path, keeping the `.js` extension.
- Remove the alias from `vite.config.ts`, the `paths` entry from `tsconfig.json`, and the alias from the root `vitest.config.ts`.
- Format only the files that changed.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Moving files.
- Any behaviour change.
- Documentation that mentions the alias (sprint 094 and 095 docs tasks).

## Acceptance criteria
- [ ] No `.ts` or `.tsx` file under `packages/` contains `@web-client/`.
- [ ] The alias is gone from all three config files.
- [ ] The number of test files and tests equals the baseline, and all pass.
- [ ] `npm run build:web-client` succeeds and `dist/web` is within 1% of the baseline size.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- `rg "@web-client/" packages -g '*.ts' -g '*.tsx'` prints nothing.
- `npx vitest run packages/web-client`
- `npm run build:web-client && npm run lint`
- `npx oxfmt --check <changed files>`

## Notes
- Use an AST-aware codemod, not text substitution: specifiers also appear inside `vi.mock("…")` calls, which hoist and must stay string literals.
- Run `tsc -b --force` after the rewrite; the incremental cache gives stale results after mass import changes.
