# Task 006 — Workflow: run the benchmark on a macOS and a Windows runner

- **Sprint:** sprint-112-desktop-ipc-benchmark
- **Status:** in_progress
- **Type:** chore
- **Area:** .github/workflows, desktop/apps/ipc-bench
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-005

## Goal
A manual workflow builds the benchmark application on a macOS and a Windows runner, runs it, and attaches the results.

## Context / why
The gate must hold on WKWebView and WebView2, and the benchmark needs no WebDriver, so a runner can run it. `release.yml` already ignores `desktop/**` and `.github/workflows/desktop-*.yml`, so this never starts a release.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 1 (where it runs; the near-threshold rule)
- .github/workflows/desktop-platform-checks.yml (the triggers and build steps to copy), `.github/workflows/release.yml` (`paths-ignore`)
- `desktop/apps/ipc-bench/`

## What to build
- `.github/workflows/desktop-ipc-benchmark.yml`: `workflow_dispatch` (inputs: runs, scale), and `pull_request` when the workflow file changes. Never on a push to `main`. Jobs on `macos-15` and `windows-latest`, each: build the application in release mode, run it, upload `results.json` and the log as an artifact, and write a table of the rows to the job summary.
- A job fails when the application exits non-zero (a run that did not finish, or B6 found something). It does not judge the thresholds: task-007 does.
- The runner's CPU model, core count and the webview version are printed in the summary.
- `desktop/docs/development.md`: how to start it and where the results are.

## Out of scope
- Running it and reading the numbers (task-007).
- A Linux job: Linux is measured on the development machine.

## Acceptance criteria
- [ ] The workflow passes `actionlint` (the `rhysd/actionlint` image).
- [ ] The command line the jobs use runs to the end on Linux in the container.
- [ ] `release.yml` is not triggered by the workflow or by `desktop/apps/ipc-bench/**`.
- [ ] The summary says that the first run needs a pull request that changes the workflow file, or the file on `main`, and that pushing a branch and opening a pull request need the owner's word.

## Test / verification plan
- `docker run --rm -v "$PWD:/repo:ro" rhysd/actionlint:latest /repo/.github/workflows/desktop-ipc-benchmark.yml`
- `cargo xtask ci` in `desktop/`

## Notes
- A workflow file that is only on a branch cannot be started by hand (`gh workflow run` answers 404): the pull-request trigger is the way, as for the platform checks.
- A WebView2 window on an elevated runner worked for the platform checks; the benchmark needs no debugging port, so the machine policy step is not needed.
