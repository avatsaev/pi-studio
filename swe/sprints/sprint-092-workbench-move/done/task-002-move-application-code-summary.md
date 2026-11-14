# Task 002 — Move the application code and its tests into the workbench — Summary

- **Sprint:** sprints/sprint-092-workbench-move
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
`git mv` of `features/ stores/ hooks/ timeline/ lib/ viewer-plugins/ test/ providers/ routes/ app.tsx design-tokens.test.ts` from `packages/web-client/src` to `packages/workbench/src` (paths unchanged); `vite-env.d.ts` moved too and marked TEMPORARY (its four Vite-only declarations go in sprint 093); `css-modules.d.ts` copied (web-client keeps its own for `main.tsx`). `src/index.ts` now temporarily exports `App` and `attachResumeTriggers`, which `web-client`'s `main.tsx` imports from `@av-pi-studio/workbench`; the sprint-091 placeholder export and its test were deleted. Dependencies split from the imports actually present (runtime → workbench `dependencies`; `@types/qrcode` and test-only `tweetnacl` → workbench `devDependencies`); web-client keeps only what `main.tsx` and `vite.config.ts` import plus `pdfjs-dist` for the pdf.js plugin. `drag-guard.test.ts` temporarily reads `global.css` from web-client (task-003 moves the rule). Docs: workbench AGENTS (state + layout), web-client AGENTS (move banner), root AGENTS layout line, handoff workbench paragraph.

## Files created / changed
| File | Change |
|------|--------|
| `packages/workbench/src/{features,stores,hooks,timeline,lib,viewer-plugins,test,providers,routes}/, app.tsx, design-tokens.test.ts, vite-env.d.ts` | moved (git mv) |
| `packages/workbench/src/css-modules.d.ts` | created (copy) |
| `packages/workbench/src/index.ts` | temporary exports |
| `packages/workbench/src/index.test.ts` | deleted (placeholder obsolete) |
| `packages/workbench/src/lib/drag-guard.test.ts` | temporary global.css path |
| `packages/workbench/src/lib/paths.ts` | oxfmt (pre-existing trailing-whitespace finding, file touched by the move) |
| `packages/workbench/package.json, packages/web-client/package.json` | dependency split |
| `packages/web-client/src/main.tsx` | imports from @av-pi-studio/workbench |
| `packages/web-client/tsconfig.json` | references trimmed to ui-library + workbench |
| `package-lock.json` | npm install (20 packages removed) |
| `AGENTS.md, packages/{web-client,workbench}/AGENTS.md, docs/desktop-client-handoff.md` | docs |

## How it satisfies the scope
`workbench-package.md` § What moves / § What stays: application directories now in the workbench, `web-client` reduced to `main.tsx`, `global.css`, `theme/fonts.css`, `assets/fonts/`, `brand/`, `vite.config.ts`, `index.html`, `public/`. Fonts and `global.css` stay for task-003, as scoped.

Dropped dependencies (nothing imports them anymore): `@floating-ui/react`, `@radix-ui/react-dialog`, `@radix-ui/react-popover`, `@radix-ui/react-tooltip`, `@testing-library/react`, `framer-motion`, `react-router`, `zod` (still a protocol/ui-library dependency), and web-client's direct `@av-pi-studio/client`/`@av-pi-studio/protocol` (now reached through the workbench; web-client's Vite aliases to their sources stay).

`tweetnacl` report: imported only by `lib/connection/resolve-connect-target.test.ts` (a test fixture building a pairing offer), not by runtime code. Kept as a workbench devDependency `^1.0.3` (same range as relay/server); routing it through `@av-pi-studio/relay` would be a test refactor, out of scope.

## Build & test results
```
$ npm install                     -> removed 20 packages
$ npx tsc -b --force              -> OK
$ npm run build                   -> OK (workbench lib build + web-client), dist/web 26530220 B (= baseline)
$ npm run typecheck               -> OK
$ npx oxlint                      -> exit 0
$ npx oxfmt --check <changed .ts/.tsx/.json> -> clean (web-client/package.json pre-existing finding excluded)
$ npx vitest run packages/workbench packages/web-client
Test Files 109 passed (109) / Tests 1453 passed (1453)   (= baseline)

Live: web-client dev server (vite :5394) + dev daemon (PI_STUDIO_LISTEN=127.0.0.1:6790, mock provider),
headless browser at /?host=127.0.0.1:6790&connect=1 -> "connected"; opened workspace /tmp, sent
"hello from the workbench move" -> assistant "echo: hello from the workbench move"; no page or console errors.
```

## Acceptance criteria
- [x] `packages/web-client/src` no longer contains the moved directories.
- [x] History preserved: moved with `git mv`; `git log --follow` verified after the sprint commit (renames detected).
- [x] Test files and tests equal the baseline (109 / 1453) and pass from the new location.
- [x] `npm run build`, `npm run typecheck`, `npm run lint` pass.
- [x] Dev server loads and connects to a daemon; a prompt round-trips.
- [x] `docs/desktop-client-handoff.md`: workbench section now says the code lives in `packages/workbench/src` (unpublished) and that the host-table paths are relative to it.

## Follow-ups / TODO(verify)
- `drag-guard.test.ts` points at `../../../web-client/src/global.css` until task-003.
- `vite-env.d.ts` (Vite-only ambient declarations) is temporary until sprint 093.
