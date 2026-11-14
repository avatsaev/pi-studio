# Task 002 — Scaffold `packages/ui-library` workspace package

- **Sprint:** sprint-088-ui-library-extract
- **Status:** done
- **Type:** chore
- **Area:** packages/ui-library, root build config
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
An empty but wired `@av-pi-studio/ui-library` workspace package that builds, typechecks and runs a trivial test, so the following move tasks land on a green pipeline.

## Context / why
New package per D1/D3. Dependency classes are fixed by D17/D28; version is lockstep (D18). Planning-time decision (open question in the brief, owner scope): ui-library **joins the root `tsc -b` references graph** (it emits declarations; web-client stays outside the graph as today).

## Scope references
- `swe/grills/ui-library.md` D1, D3, D17, D18, D28; § Integration points (root package.json, tsconfig)
- root `package.json` (`workspaces`, `build*` scripts), `tsconfig.json`, `tsconfig.base.json`, `vitest.config.ts`
- `packages/protocol/package.json` + `tsconfig.json` (pattern to copy)

## What to build
- `packages/ui-library/package.json`: name `@av-pi-studio/ui-library`, version = current aligned version, `type: module`, `peerDependencies` `react`/`react-dom` `^19`; `dependencies` `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-popover`, `lucide-react`, `clsx`, `zustand`, `zod` at web-client's current ranges; `files` allowlist (`dist`, excluding maps/tsbuildinfo, per repo convention); `sideEffects: ["**/*.css"]` (D29). `exports`/build script are placeholders filled by s089/t001.
- `packages/ui-library/tsconfig.json` (composite, `jsx: react-jsx`, DOM libs, `rootDir: src`, `outDir: dist`, declarations).
- `src/index.ts` with one trivial export + one trivial `*.test.ts` so `npm test` discovers the package (root vitest `include` already globs `packages/*/src`).
- Root: add to `workspaces`, `tsconfig.json` references, `build:ui-library` script, and insert it into `build` **after client, before server/web-client**.
- `npm install` to update `package-lock.json`.

## Out of scope
- Moving any code (t003/t004); Vite library build + `exports` (s089/t001); docs (s090/t005).

## Acceptance criteria
- [x] `npm run build`, `npm run typecheck`, `npm test` all pass with the new package present.
- [x] `package-lock.json` contains the workspace link.

## Test / verification plan
- Build: `npm run build:web-client` (and `npm run build` at sprint end) succeeds.
- Typecheck/Lint: `npm run typecheck`, `npm run lint`, `npx oxfmt --check <changed files>` clean.
- Tests: `npm test` green.
