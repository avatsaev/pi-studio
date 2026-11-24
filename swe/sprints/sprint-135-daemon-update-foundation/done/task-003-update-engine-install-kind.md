# Task 003 — The update engine moves to the server; install kind

- **Sprint:** sprints/sprint-135-daemon-update-foundation
- **Status:** done
- **Type:** refactor
- **Area:** packages/server (update/), packages/cli (update-control)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
`packages/server/src/update/npm.ts` and `install-kind.ts` exist; the CLI's `update-control.ts` uses them.

## Context / why
Spec § Where the code lives (P6), § Install kind (P3), § Check (P4: npm found, folder writable).

## Scope references
- `swe/features/self-update.md` § Install kind, § Where the code lives, § Check
- `packages/cli/src/update-control.ts` (+ test), `packages/cli/src/update-commands.ts`
- new `packages/server/src/update/npm.ts`, `install-kind.ts` (+ tests), `packages/server/src/index.ts` or the package `exports` the CLI imports through (see how the CLI imports the extensions planner)
- `docker/daemon.Dockerfile` (`ENV PI_STUDIO_INSTALL_KIND=docker`)
- `packages/server/src/version.ts` (add `PACKAGE_NAME`)

## What to build
- `npm.ts`: `npmLatestVersion`, `compareVersions`, `npmGlobalInstall` with the ENOTEMPTY retry: moved, same behavior, same seams.
- `install-kind.ts`: `detectInstallKind(env, selfUrl, npmRootGlobal)` per the spec's table; `npmRootGlobal()` cached; `canWriteGlobalFolder()`; `npmOnPath()`; `updateBlocker(kind, platform)` → `null` or a `cannot_update` reason.
- The CLI keeps its `UpdateRuntime` seam and imports the implementations; the moved unit tests move with the code.

## Out of scope
The service, RPCs and timer (sprint-136).

## Acceptance criteria
- [ ] Kind: env wins; a path under a fake global folder → `npm-global`; a workspace root → `source`; else `unknown`; all four tested.
- [ ] `pi-studio update --check` behaves as before (its tests pass unchanged or with imports updated only).
- [ ] The Docker image sets the kind (Dockerfile test or a grep test if the repo has one for Dockerfiles; else documented).

## Test / verification plan
- `npx vitest run packages/server/src/update packages/cli/src`
- `npm run build && npm run typecheck && npm run lint`

## Notes
Docs: `packages/cli/AGENTS.md` (third narrow import exception), `packages/server/AGENTS.md` (source tree), `docker/README.md` and root `AGENTS.md` env table (`PI_STUDIO_INSTALL_KIND`).
