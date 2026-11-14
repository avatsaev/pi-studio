# Task 003 — Scaffold `packages/workbench` and wire it into the workspace

- **Sprint:** sprint-091-workbench-spike-scaffold
- **Status:** backlog
- **Type:** chore
- **Area:** packages/workbench, repo root, packages/web-client
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002

## Goal
Create an empty, building `@av-pi-studio/workbench` package that `web-client` resolves from source.

## Context / why
Later tasks only move and change code. The package, its build, its place in the root build and test setup, and the source alias must exist first so every later step can be verified.

## Scope references
- `swe/architecture/workbench-package.md` § Package, § Development workflow, § Release wiring
- `packages/ui-library/{package.json,tsconfig.json,vite.config.ts}` (precedent)
- `package.json` (root scripts), `tsconfig.json` (root references), `vitest.config.ts` (aliases)
- `packages/web-client/{package.json,vite.config.ts,tsconfig.json}`

## What to build
- Create `packages/workbench/package.json`: name `@av-pi-studio/workbench`, the current lockstep version, `license`, `repository.directory`, `type: module`, `sideEffects: ["**/*.css"]`, `files`, `exports` (`.` and `./package.json` for now), peers `react` and `react-dom` `^19.0.0`, dependencies on `@av-pi-studio/protocol`, `@av-pi-studio/client` and `@av-pi-studio/ui-library` at `^<version>`, scripts `build` (`vite build && tsc -b`) and `clean`.
- Create `tsconfig.json` (declarations only, DOM libs, `react-jsx`, tests excluded, references to `protocol`, `client`, `ui-library`), `vite.config.ts` (library mode per the spike), `src/index.ts` with one placeholder export, and one trivial test.
- Root: add `build:workbench`, call it in `build` right after `build:ui-library`; add the project reference; add a vitest alias from `@av-pi-studio/workbench` to `packages/workbench/src/index.ts`.
- `web-client`: add the devDependency, a Vite alias to the workbench source, and the tsconfig reference.
- Run `npm install` to update the lockfile.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Moving any application code.
- `scripts/publish.sh` and the Dockerfile (sprint 095).

## Acceptance criteria
- [ ] `npm run build:workbench` emits `dist/index.js` and `dist/index.d.ts`.
- [ ] `npm run build`, `npm run typecheck`, `npm run lint` and `npm test` pass.
- [ ] `npm ls @av-pi-studio/workbench` shows the workspace link.
- [ ] `web-client` can import the placeholder export in dev and in a production build.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- `npm run build:workbench`
- `npx vitest run packages/workbench`
- `npm run build && npm run typecheck && npm run lint`

## Notes
- A private workspace package must depend on workspace packages with `*`; a published one uses `^<version>`. The 0.0.117 release failed because a private package pinned a version that was not on the registry.
- Do not add the package to `scripts/publish.sh` yet: it must not be published before the branch is complete.
