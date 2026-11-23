# Task 002 — `desktop-release.yml`: signed update files, per-release manifests, the update check and promotion

- **Sprint:** sprints/sprint-134-desktop-update-release
- **Status:** backlog
- **Type:** feature
- **Area:** .github/workflows/desktop-release.yml
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, sprint-131/task-002, sprint-131/task-003

## Goal
A publishing run signs update files, publishes them with `latest.json` and `self-check.json`, runs the
update check on Linux, macOS and Windows, and moves `desktop-updates/latest.json` only when all pass. A
pull request changing the workflow runs the same check on test builds and publishes nothing.

## Context / why
Spec § Behavior & algorithms (The release workflow), D6, D8, U1, U2, U3, P2.

## Scope references
- `swe/features/desktop-self-update.md` § 1, § 2, § Behavior (The release workflow), U1–U3, U5
- `.github/workflows/desktop-release.yml` (jobs `version`, `bundle`, `release`; new `update-check`,
  `promote`)

## What to build
- `bundle` in a publishing run: `environment: desktop-release`, `TAURI_SIGNING_PRIVATE_KEY`, the
  overlay `{"bundle":{"createUpdaterArtifacts":true}}`; upload the update files and `.sig`s. Other runs
  unchanged, except a PR run builds test builds (throwaway key, test overlay).
- `release`: `update-manifest.mjs` for both manifests; upload with the installers.
- `update-check` (matrix of three, fail-fast off, after `release`): find P from
  `desktop-updates/latest.json` (absent or pre-updater → self check only); run `update-check.mjs`.
  In a PR run: serve the test files from a local HTTP server.
- `promote` (needs every `update-check`): create `desktop-updates` with `--latest=false` the first time;
  `gh release upload --clobber`.
- The version step still ignores `desktop-updates` (test the tag filter).
- Workflow header comment updated.

## Acceptance criteria
- [ ] A PR run (this branch) passes `update-check` on the three systems with test builds, and
  `release`/`promote` are skipped; the time `update-check` took is recorded.
- [ ] No job of a PR run names the environment or the secret.

## Test / verification plan
- Push the branch; the PR's run; `gh run view` for each job.
