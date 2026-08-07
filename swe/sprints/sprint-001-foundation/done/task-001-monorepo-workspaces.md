# Task 001 — Monorepo workspaces + tooling skeleton

- **Sprint:** sprint-001-foundation
- **Status:** done
- **Estimated size:** S
- **Depends on:** none

## Goal
Stand up the npm-workspaces monorepo with TypeScript (ESM, strict), lint/format, and a Vitest
harness so every later package builds and tests in a known-green state.

## Scope references
- `clean-room-scope/MAIN-SCOPE.md` § 2 (Tech Stack & Runtime), § 4 (Directory / Module Map), § 7 (Build/Run/Test/Deploy)

## What to build
- Create the repo root with `package.json` declaring npm workspaces for the packages listed in
  MAIN-SCOPE § 4: `packages/protocol`, `packages/client`, `packages/server`, `packages/app`,
  `packages/cli`, `packages/desktop`, `packages/relay`, `packages/highlight`.
- Create per-package `package.json` placeholders (name `@av-pi-studio/<pkg>`, ESM `"type":"module"`)
  and `tsconfig.json` with strict typing; root `tsconfig.base.json` shared config.
- Add `oxlint` + `oxfmt` config and root scripts (`lint`, `fmt`).
- Add `vitest` as the test runner; configure per-file run style (`npx vitest run <file>`).
- Add a trivial passing test in one package (e.g. `packages/protocol`) to prove the harness.

## Out of scope
- Any real protocol/server/client logic (later sprints).
- Build layering scripts and cross-package `.d.ts` (task-002).

## Acceptance criteria
- [ ] `npm install` at root links all workspaces without error.
- [ ] `npx vitest run packages/protocol/<trivial>.test.ts` passes.
- [ ] `oxlint` and `oxfmt` run clean on the skeleton.
- [ ] Each package resolves its own `tsconfig` extending the base.

## Test / verification plan
- Install: `npm install` succeeds.
- Tests: `npx vitest run <trivial test path>` → 1 passing test.
- Lint: `npx oxlint` exits 0; `npx oxfmt --check` exits 0.

## Notes
- ESM throughout; strict TS. Zod is the validation library used at every boundary (added where first
  needed). Keep package boundaries matching MAIN-SCOPE § 4.
