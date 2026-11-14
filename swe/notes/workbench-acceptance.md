# Workbench acceptance sweep

Run 2026-11-14 on `feat/workbench` at the end of sprint 095 (task-003). Baselines:
`swe/notes/workbench-baseline.md`.

## `architecture/workbench-package.md` § Acceptance criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | `packages/workbench` builds; `dist` has `index.js`, `index.d.ts`, `styles.css`, `fonts.css`, font files, `vite` entry | `npm run build` from a clean tree (`npm run clean` first) passes; `scripts/check-dist.mjs` prints `ok`; `pack-smoke.sh` resolves both entries |
| 2 | `web-client/src` is only the shell | `ls packages/web-client/src`: `brand/`, `css-modules.d.ts`, `global.css`, `main.tsx`, `vite-env.d.ts` |
| 3 | No `@web-client/` imports | `rg -l "@web-client/"` over the repo excluding `swe/`, `*.md`, `node_modules`: no hits |
| 4 | Test count does not drop | 109 files / 1453 tests at baseline; 267 files / 3582 tests now (`npm test`, all passing; the rest were added by sprints 092–094) |
| 5 | build, typecheck, lint, test pass | Clean tree: `npm run clean && npm run build && npm run typecheck && npm run lint` pass (warnings only, all pre-existing categories); `npm test` 267 / 3582 pass. `npm run fmt:check` is **not** green repo-wide, see "Format check" below |
| 6 | `dist/web` loads and behaves as before; size within 1% | Browser, built `dist/web` over a static server: connect to a production daemon (isolated `PI_STUDIO_HOME`, port 6790), open a workspace, split a pane, open a file, open a terminal and run a command (output seen); on a dev daemon (6791) a mock turn streamed (`echo: …`). Size 26 533 932 B vs 26 530 220 B at baseline (+0.014%), 658 files vs 657 |
| 7 | Library `dist` has no third-party code, base64 font/worker, `?worker`, `import.meta.env`, `__APP_VERSION__`, `__BRAND_TITLE__` | `check-dist.mjs` (runs in `build`) |
| 8 | Every dynamic import stays dynamic | `check-dist.mjs` lazy-chunk check; `pack-smoke.sh`: "mermaid, shiki languages, pdf.js and the molecule viewer are lazy" |
| 9 | Packed-tarball consumer renders `Workbench`, connects, streams a mock turn, no console errors | `pack-smoke.sh` ALL PASS (install, `skipLibCheck: false` types, vite build); the browser run of that consumer was done in sprint 094 task-003 against a dev daemon |
| 10 | Same consumer renders a custom shell (`WorkbenchProvider`, `WorkbenchBoot`, `SessionList`, `PaneArea`) and connects through `useConnection()` | Sprint 094 task-003 (second entry of the smoke consumer, browser-verified) |
| 11 | `build:electron` / `VITE_TARGET` gone; `pi-studio ui` and the Docker image build and serve | `rg "build:electron\|VITE_TARGET"` outside `swe/` and `dist`: no hits; Docker image built and served `/`, the entry JS and a pdf.js data file with 200s (095 task-001) |
| 12 | `publish.sh --dry-run` succeeds with the new package in the order | `GITHUB_ACTIONS=true npm run publish -- --dry-run` in a throwaway worktree at `ad5a8fd` (after `npm ci`): bump to 0.0.118, lockfile sync, build with `check-dist: ok`, typecheck, tests 267 / 3582, dry-run publish of all eight packages in order protocol, relay, client, ui-library, workbench, web-client, server, cli. Worktree and branch removed |
| 13 | Docs updated in the same change | `packages/workbench/{README,AGENTS,CHANGELOG,RELEASING}.md`, `packages/web-client/{README,AGENTS}.md`, root `AGENTS.md`/`README.md`, `docs/build-layering.md`, `docs/desktop-client-handoff.md`, `CONTRIBUTING.md`, `swe/MAIN-SCOPE.md`. Root `README.md` needed no change (it names no package list or release order); `docker/README.md` likewise |

## `architecture/workbench-host-adapter.md` § Acceptance criteria

All eight were ticked in sprint 093 task-007 and are unchanged. They are re-exercised by the 3582
passing tests, including `host/host-guard.test.ts` and the public-API tests.

## Format check

`npm run fmt:check` fails on 39 files, none of them touched by this branch except
`packages/web-client/package.json` (a pre-existing finding left alone). Evidence the rest predates
the branch: `packages/relay/src/channel.ts` is byte-identical to `main` and fails. A further 18
files under `docs/UI design/` were failing only because the folder moved out of `swe/**`, which
`.oxfmtrc.json` ignores; `docs/UI design/**` is now ignored too.

## Known gaps

- `fern check` was not run (fern is not installed here); the only fern change is a YAML comment.
- Tauri-webview behaviour of `window.confirm` and `target="_blank"` is unverified until the desktop
  app runs it.
- The mock turn was checked on a dev daemon; the production daemon has no model credentials in the
  isolated home, so a real model turn was not run.
