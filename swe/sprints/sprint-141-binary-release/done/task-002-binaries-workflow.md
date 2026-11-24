# Task 002 — Binaries built, smoke-tested and published by every release

- **Sprint:** sprints/sprint-141-binary-release
- **Status:** done
- **Type:** feature
- **Area:** .github/workflows
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, sprint-140/task-003

## Goal
After the npm release, four jobs build and smoke-test the binaries on their own systems, and one job
publishes `daemon-v<version>` and updates `daemon-updates/latest.json` only when all four passed.

## Context / why
P1, P13, S1, S3, A10. npm and Docker must never wait for or fail because of these jobs.

## Scope references
- `swe/features/single-binary-daemon.md` § Release
- `.github/workflows/release.yml` (one job today); create `.github/workflows/daemon-binaries.yml`
  (`workflow_call` with inputs version, ref, publish; and `pull_request` on the paths that change the
  binary: `packages/**`, `scripts/build-binary.mjs`, `scripts/binary-smoke.mjs`, `scripts/release/daemon-*`,
  the workflow itself — build and smoke only)
- Pattern: `.github/workflows/desktop-release.yml` (`bundle`, `release`, `promote`, and the fixed
  `promote` condition of PR #67)

## What to build
- `release.yml`: the release job outputs the version and the commit it pushed; a second job calls
  `daemon-binaries.yml` with `publish: true` after it.
- `daemon-binaries.yml`: matrix `linux-x64` on `ubuntu-24.04`, `linux-arm64` on `ubuntu-24.04-arm`,
  `darwin-arm64` on `macos-15`, `darwin-x64` on an Intel macOS runner (find the label; record it);
  each: checkout the ref, `npm ci`, `npm run build`, `npm run build:binary`, `npm run test:binary`,
  upload the archive as an artifact. A publish job, `needs` all four with an explicit
  `if: ${{ !cancelled() && inputs.publish && needs.build.result == 'success' }}`: download, run
  `daemon-manifest.mjs`, `gh release create daemon-v<v> --latest=false`, create `daemon-updates`
  (`--latest=false`) if missing, upload `latest.json --clobber`. Step time limits on the smoke test
  (10 min).

## Out of scope
The desktop's pin (task-003).

## Acceptance criteria
- [ ] `actionlint` clean on both workflows.
- [ ] A pull request that changes `packages/` builds and smoke-tests the four targets and publishes nothing (task-004 runs it).
- [ ] The publish job's condition names the build result (no bare `if`).

## Test / verification plan
- `actionlint`; the pull request run of task-004.

## Notes
The publish path is first seen on the first run after the owner's merge (sprint-142/task-006).
