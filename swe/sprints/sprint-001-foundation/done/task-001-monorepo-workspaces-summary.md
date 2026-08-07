# Task 001 — Monorepo workspaces + tooling skeleton — Summary

- **Sprint:** sprint-001-foundation
- **Completed:** 2026-06-11
- **Status:** done

## What was implemented
Stood up the npm-workspaces monorepo for Pi-Studio with strict ESM TypeScript, oxlint/oxfmt
tooling, and a Vitest harness. All eight packages from MAIN-SCOPE §4 exist as linkable workspaces
with their own `package.json` (`@av-pi-studio/<pkg>`, `"type":"module"`) and `tsconfig.json`
extending a shared `tsconfig.base.json`. A trivial passing test in `packages/protocol` proves the
test harness.

## Files created / changed
| File | Change |
|------|--------|
| `package.json` | created (root, npm workspaces + scripts + devDeps) |
| `tsconfig.base.json` | created (shared strict ESM config) |
| `tsconfig.json` | created (root solution-style references) |
| `.oxlintrc.json` | created (oxlint config) |
| `.oxfmtrc.json` | created (oxfmt config, ignores `clean-room-scope/`) |
| `vitest.config.ts` | created (per-file run style) |
| `.gitignore` | created |
| `packages/protocol/{package.json,tsconfig.json,src/index.ts}` | created |
| `packages/protocol/src/harness.test.ts` | added trivial passing test |
| `packages/{highlight,relay,client,server,cli}/{package.json,tsconfig.json,src/index.ts}` | created |
| `packages/{app,desktop}/{package.json,tsconfig.json,src/index.ts}` | created (Metro/Electron — noEmit) |

## How it satisfies the scope
- **MAIN-SCOPE §2 (Tech Stack):** TypeScript ESM + strict (`tsconfig.base.json` `strict:true`,
  `verbatimModuleSyntax`, `isolatedModules`); npm workspaces; oxlint/oxfmt; Vitest; Zod added as a
  dependency in `protocol`/`server` (used by task-003 and later boundaries).
- **MAIN-SCOPE §4 (Module Map):** all eight package directories created with the exact names
  (`protocol, client, server, app, cli, desktop, relay, highlight`).
- **MAIN-SCOPE §7 (Build/Run/Test):** per-package `build`/`clean` scripts; Vitest per-file run style
  (`npx vitest run <file>`). Build layering itself is task-002.

## Build & test results
```
$ npm install
added 58 packages, audited 67 packages — 0 errors; 8 workspace symlinks created under node_modules/@av-pi-studio/

$ npx vitest run packages/protocol/src/harness.test.ts
 ✓ packages/protocol/src/harness.test.ts (1 test) 1ms
 Test Files  1 passed (1)
      Tests  1 passed (1)

$ npx oxlint
(exit 0 — no findings)

$ npx oxfmt --check .
All matched files use the correct format.
(exit 0)
```

## Acceptance criteria
- [x] `npm install` at root links all workspaces without error (8 symlinks under `node_modules/@av-pi-studio/`).
- [x] `npx vitest run packages/protocol/src/harness.test.ts` passes (1 test).
- [x] `oxlint` exits 0 and `oxfmt --check` exits 0 on the skeleton.
- [x] Each package resolves its own `tsconfig` extending `../../tsconfig.base.json`.

## Follow-ups / TODO(verify)
- `app` and `desktop` are scaffolded with `noEmit` tsconfigs since they build via Metro/Electron
  (per MAIN-SCOPE §7); their real build wiring is deferred to the app/desktop sprints.
- oxfmt reformatted the 31 source/config files on first write; `clean-room-scope/**` is excluded
  from formatting via `.oxfmtrc.json` so specs stay untouched.
