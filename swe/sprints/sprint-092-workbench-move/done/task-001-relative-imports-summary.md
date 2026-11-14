# Task 001 — Replace `@web-client/*` with relative imports — Summary

- **Sprint:** sprints/sprint-092-workbench-move
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
Rewrote all 452 `@web-client/…` specifiers (static imports, `export … from`, dynamic `import()`, `vi.mock`/`vi.doMock`/`vi.importActual` strings) in 151 files to relative paths with an AST codemod: each string-literal node was matched by ast-grep and replaced with the path relative to its file's directory (computed per directory, `.js` extensions kept). Removed the alias from `packages/web-client/vite.config.ts`, the `paths` entry from `packages/web-client/tsconfig.json`, and the alias from the root `vitest.config.ts`. oxfmt was then run on the 8 changed files it flagged (shorter specifiers let multi-line imports collapse).

## Files created / changed
| File | Change |
|------|--------|
| `packages/web-client/src/** (151 files)` | specifiers rewritten |
| `packages/web-client/vite.config.ts` | alias removed |
| `packages/web-client/tsconfig.json` | `paths` removed |
| `vitest.config.ts` | alias removed |
| `packages/web-client/AGENTS.md` | alias statement updated |

## How it satisfies the scope
`workbench-package.md` § Imports inside the package: sources now use relative imports only, so the move in task-002 is a pure `git mv` and emitted `.d.ts` files will resolve for consumers. Pre-check: every occurrence was a complete quoted string literal ending in `.js`/`.css`/`.json`, so no template literal or comment needed handling.

## Build & test results
```
$ rg "@web-client/" packages -g '*.ts' -g '*.tsx'
(no output)

$ npx tsc -b --force packages/web-client      -> OK
$ npx vitest run packages/web-client
Test Files 109 passed (109) / Tests 1453 passed (1453)   (= baseline)

$ npm run build:web-client && du -sb packages/web-client/dist/web | cut -f1
26530220   (= baseline, 0% delta)

$ npx oxlint packages/web-client               -> exit 0
$ npx oxfmt --check <changed files>            -> clean (154 files)
```

## Acceptance criteria
- [x] No `.ts`/`.tsx` file under `packages/` contains `@web-client/`.
- [x] The alias is gone from all three config files.
- [x] Test files and tests equal the baseline (109 / 1453), all pass.
- [x] `npm run build:web-client` succeeds; `dist/web` is byte-for-byte the baseline size.
- [x] `docs/desktop-client-handoff.md`: nothing affected (it does not mention the alias).

## Follow-ups / TODO(verify)
- None.
