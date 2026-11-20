# Task 004 — Automated platform checks on macOS and Windows runners (daemon registry)

- **Sprint:** sprint-111-desktop-daemon-registry-close
- **Status:** blocked
- **Type:** test
- **Area:** .github/workflows/desktop-platform-checks.yml, desktop/apps/pistudiodesktop/scripts, desktop/docs
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, sprint-106/task-004

## Goal
The platform-checks workflow also covers the daemon registry: the local daemon on macOS through the real CLI, the registry file and its mode, `unsupported` on Windows, and switching between entries in the Windows webview.

## Context / why
Same reason as sprint-106/task-004: the manual run of task-002 should keep only what needs a person. macOS is where finding and running the CLI matters most, and a macOS runner has Node, so most of it can be checked without a person.

## Scope references
- `.github/workflows/desktop-platform-checks.yml` and its check script (sprint-106/task-004)
- `desktop/docs/platform-checks.md` (the registry section: task-001)
- `swe/features/desktop-daemon-registry.md` § Acceptance criteria, § Finding and running the CLI, § TODO(verify)
- `packages/cli` (built from this repository in the job: `npm ci && npm run build`)

## What to build
- **macOS job, through the control socket:**
  1. the repository's CLI built and linked so that only the login shell's start-up file puts it on `PATH`; the app launched with an emptied environment (as from the dock): the local state reaches `stopped`, not `cli_missing`. Run with `zsh` (the macOS default) and `bash`;
  2. `daemon.local.start` with a scratch `PI_STUDIO_HOME` and a free port: `running`, and the daemon answers its health check; the time it took is printed;
  3. quitting the app leaves the daemon running; `daemon.local.stop` afterwards stops it;
  4. `daemon.add` of a direct entry with a password: `daemons.json` is mode 0600, and no control answer or log line of the run contains the password;
  5. a CLI reporting 0.0.118 (the fake CLI of sprint-108/task-004) gives `cli_outdated`.
- **Windows job, through WebDriver:**
  1. the local entry's state is `unsupported`, and the Daemons screen shows the explanation with no Start;
  2. add two direct entries pointing nowhere, switch between them from the switcher: the page reloads on each and each keeps its own stored layout, with the same theme;
  3. `daemons.json` exists in the configuration directory (its location printed).
- **`desktop/docs/platform-checks.md`:** mark the registry items now automated.

## Out of scope
- The native "Daemons" menu and the macOS Edit menu (no driver reaches native menus), a WSL2 daemon, a launch from the real dock: manual, task-002.

## Acceptance criteria
- [ ] A run is green on both runners with the new checks, artifacts and summary.
- [ ] Removing the shell-environment lookup (tried locally on the branch, then reverted) turns the macOS job's check 1 red.
- [ ] The summary prints the start duration and which shells found the CLI.
- [ ] The checklist marks the automated registry items.
- [ ] Every daemon started by the job uses a scratch home and is stopped at the end, also on failure.
- [ ] `cargo xtask ci` passes; the script passes the app's lint.

## Test / verification plan
- A `workflow_dispatch` run on the branch.
- `npm run lint` in `desktop/apps/pistudiodesktop`; `cargo xtask ci` in `desktop/`.

## Notes
- Pushing the branch to run the workflow is the engineer's decision: ask first; never push to `main`.
- An emptied environment on a runner is not identical to a launch from the dock (launchd sets a few variables of its own); task-002's person still checks the dock once.

## Blocker
Built together with sprint-106/task-004 (one workflow and one script): the registry checks (`registry.macos.*`, `registry.windows.*`) are written and validated on Linux only — the macOS shell-environment check was rehearsed with bash against the real CLI and went red with `cli_missing` when pointed at a shell that ignores the start-up file. **A run on GitHub's runners is the acceptance criterion. The branch is pushed (2026-11-20) but `workflow_dispatch` is refused (404) while the workflow file is only on the branch, so the run needs a pull request from `feat/desktop-client` into `main` (the workflow runs on a pull request that changes it; do not merge until the results are read — a merge to `main` starts the release pipeline).** Unblock after sprint-106/task-004's run; then also try, on a throwaway commit, removing the shell-environment lookup and confirm the macOS job's `registry.macos.cli-found.*` goes red (revert it), and read the start duration and the shells that found the CLI from the summary.
