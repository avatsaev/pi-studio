# Task 004 — Remove the `electron` build target

- **Sprint:** sprint-092-workbench-move
- **Status:** backlog
- **Type:** chore
- **Area:** packages/web-client
- **Priority:** P2
- **Estimated size:** XS
- **Depends on:** task-003

## Goal
Delete the unused `electron` Vite target so `web-client` has one build.

## Context / why
Nothing in the repository consumes `dist/electron`: the CLI and the Docker image use `dist/web`. The desktop client is a Tauri app in another repository. Decided 2026-11-14.

## Scope references
- `swe/architecture/workbench-package.md` § `electron` target removal
- `packages/web-client/{package.json,vite.config.ts,src/vite-env.d.ts}`
- `packages/workbench/src/features/files/pdfjs-runtime.ts` (comment mentions Electron)
- `packages/cli/src/ui-commands.ts` (resolves `dist/web`)
- `docker/web-client.Dockerfile`

## What to build
- Remove the `build:electron` script.
- In `vite.config.ts` remove the `VITE_TARGET` switch, the relative-base branch and the `import.meta.env.VITE_TARGET` define; `base` is `/` and `outDir` is `dist/web`.
- Update comments and every non-historical document that names the target or the command (`packages/web-client/README.md` and `AGENTS.md`, root `AGENTS.md`, `docs/build-layering.md`, `swe/MAIN-SCOPE.md` § Tech stack).
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- Changing `dist/web`'s path or contents.

## Acceptance criteria
- [ ] `rg "VITE_TARGET|build:electron|dist/electron"` finds nothing outside `swe/sprints/`, `swe/grills/`, `swe/notes/` and superseded specs.
- [ ] `npm run build:web-client` emits `dist/web` with the same chunk-name list as the baseline.
- [ ] The CLI's `pi-studio ui` tests pass and `docker build -f docker/web-client.Dockerfile .` succeeds.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- `npm run build:web-client`
- `npx vitest run packages/cli`
- `docker build -f docker/web-client.Dockerfile -t pi-studio-web-client:test .`
