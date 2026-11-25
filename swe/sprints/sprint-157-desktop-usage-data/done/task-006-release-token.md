# Task 006 — Release workflow: the token in published builds only

- **Sprint:** sprints/sprint-157-desktop-usage-data
- **Status:** done
- **Type:** chore
- **Area:** .github/workflows/desktop-release.yml, desktop release tests
- **Priority:** P1
- **Estimated size:** XS
- **Depends on:** none

## Goal
Only `bundle-release`'s Bundle step compiles with `PISTUDIODESKTOP_POSTHOG_TOKEN`, from the repository
variable `vars.POSTHOG_PROJECT_TOKEN` (already set by the owner, 2026-11-25); a test guards that no
other step, job or workflow references it.

## Context / why
Spec § 1, U1, U2, D12, D13. Pull-request test builds, manual runs and forks must have no token; no job
may set `PISTUDIODESKTOP_USAGE_ENDPOINT`.

## Scope references
- `swe/features/desktop-usage-data.md` § 1, U1, U2
- `.github/workflows/desktop-release.yml` (job `bundle-release`, step "Bundle")
- A test beside the existing ones: `desktop/apps/pistudiodesktop/scripts/release/*-test.mjs`
  (`node --test`) or `desktop/apps/pistudiodesktop/src-tauri/tests/updater_config.rs`'s style; choose
  the one the workflow's other guards use

## What to build
- `env: PISTUDIODESKTOP_POSTHOG_TOKEN: ${{ vars.POSTHOG_PROJECT_TOKEN }}` on that one step.
- A test reading every file in `.github/workflows/` and `.github/actions/`: `POSTHOG_PROJECT_TOKEN` and
  `PISTUDIODESKTOP_POSTHOG_TOKEN` each appear exactly once, together, in `bundle-release`'s Bundle step
  of `desktop-release.yml`; `PISTUDIODESKTOP_USAGE_ENDPOINT` appears nowhere. (The variable is in environment `desktop-release`, which
  only that job names; the single reference is the extra guard.)

## Out of scope
Setting the variable on GitHub: done by the owner on 2026-11-25.

## Acceptance criteria
- [x] The test passes on the change and fails when the token is added to `bundle`.
- [x] `actionlint` (if the repo runs it) and the desktop gate pass.

## Test / verification plan
- `node --test desktop/apps/pistudiodesktop/scripts/release/` (or the Rust test), `cd desktop && cargo xtask ci`
