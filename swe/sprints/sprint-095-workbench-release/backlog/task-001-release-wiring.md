# Task 001 — Release wiring and a dry-run publish

- **Sprint:** sprint-095-workbench-release
- **Status:** backlog
- **Type:** chore
- **Area:** scripts, docker, packages/workbench
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-094

## Goal
Put the workbench into the release pipeline and prove the pipeline accepts it before anything reaches `main`.

## Context / why
The 0.0.117 release failed after the `ui-library` merge because the bump-then-install step was never rehearsed. Every push to `main` runs the full release, so the rehearsal has to happen on the branch.

## Scope references
- `swe/architecture/workbench-package.md` § Release wiring
- `scripts/publish.sh` (`PUBLISH_ORDER`, `ALL_PACKAGES`, bump loop, lockfile sync)
- `docker/web-client.Dockerfile`
- `packages/ui-library/RELEASING.md` (first-publish runbook precedent)
- Root `AGENTS.md` § Release & production deployment

## What to build
- `scripts/publish.sh`: `PUBLISH_ORDER=(protocol relay client ui-library workbench web-client server cli)`; add `workbench` to `ALL_PACKAGES`; update the script's comments that count or list packages.
- `docker/web-client.Dockerfile`: copy the workbench manifest before `npm ci` and its sources before the build.
- `packages/workbench/RELEASING.md`: first-publish steps (placeholder publish, Trusted Publisher for `release.yml`) and rollback, following the `ui-library` runbook.
- Rehearse in a throwaway git worktree with a temporary commit, so the branch stays clean: run `npm run publish -- --dry-run`. It must bump every package, sync the lockfile, build, typecheck, test and dry-run-publish all eight packages.
- Build the web-client Docker image.
- Keep `docs/desktop-client-handoff.md` current: update whatever this task makes stale there (status table, workbench and host sections, wire facts, milestones, open questions). Say in the summary what changed in it, or that nothing did.

## Out of scope
- A real publish.
- The placeholder publish and Trusted Publisher registration: those are the engineer's (task-003).

## Acceptance criteria
- [ ] The dry run completes for all eight packages in the stated order.
- [ ] The lockfile sync inside the dry run succeeds with no registry lookup failure for any workspace package.
- [ ] `docker build -f docker/web-client.Dockerfile .` succeeds and the container serves the application.
- [ ] The throwaway worktree and branch are removed; the feature branch has no bumped versions.
- [ ] `docs/desktop-client-handoff.md` matches the repository after this task, or the summary states that nothing in it was affected.

## Test / verification plan
- `npm run publish -- --dry-run` in the worktree.
- `docker build -f docker/web-client.Dockerfile -t pi-studio-web-client:test . && docker run --rm -p 8089:8080 pi-studio-web-client:test`, then fetch `/`.

## Notes
- The bump rewrites every `@av-pi-studio/*` range in the listed packages to the next version and then runs `npm install`. Any workspace package outside `ALL_PACKAGES` that pins a version range will fail the sync: such packages must use `*`.
- `publish.sh` skips versions already on npm, so a failed release can be re-run.
