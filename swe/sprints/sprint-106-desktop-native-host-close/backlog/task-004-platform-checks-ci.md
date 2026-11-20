# Task 004 — Automated platform checks on macOS and Windows runners (native host)

- **Sprint:** sprint-106-desktop-native-host-close
- **Status:** backlog
- **Type:** test
- **Area:** .github/workflows (new workflow), desktop/apps/pistudiodesktop/scripts, desktop/docs
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001

## Goal
A manually started workflow builds the app on GitHub's macOS and Windows runners and checks automatically the parts of the platform checklist a machine can check, so the manual run of task-002 shrinks to what needs a person.

## Context / why
The development machine is Linux. The macOS (WKWebView) and Windows (WebView2) webviews cannot run there, and the manual checklist needs a person with those machines. GitHub's runners have both systems; `desktop-release.yml` already builds the installers there. What a runner can see differs per system:
- **Windows:** WebView2 has a WebDriver (`msedgedriver`), reached through `tauri-driver`, so the page itself can be driven, as on Linux.
- **macOS:** WKWebView has no WebDriver. Only what Rust exposes can be checked: the control socket and the files.

## Scope references
- `desktop/docs/platform-checks.md` (task-001: the checklist this task marks)
- `swe/notes/desktop-preview-origin-spike.md` (the probe page and how to read it)
- `.github/workflows/desktop-release.yml` (how the app is built on each runner: toolchains, pinned actions, `shell: bash`), `.github/workflows/desktop-ci.yml`
- `desktop/docs/development.md` (WebDriver on Linux; the control socket and `--config-dir`), `desktop/docs/control-protocol.md`
- `desktop/apps/pistudiodesktop/scripts/` (where a check script lives beside `snapshot.mjs`)

## What to build
- **A new workflow, `desktop-platform-checks.yml`**: started by hand (`workflow_dispatch`) and by a pull request that changes it; never by a push to `main`; never publishes anything. Two jobs, `windows-latest` and `macos-15`, each builds the app the way `desktop-release.yml` does (a debug build is enough) and runs one check script. Actions pinned by commit, as in the existing workflows. Results as a job summary plus the screenshots and logs as artifacts.
- **One check script** (Node, no new dependency beyond what the app's package already has; the W3C WebDriver protocol is plain HTTP), with two modes:
  - **Windows, through `tauri-driver` + a matching `msedgedriver`:**
    1. the app boots and the workbench is drawn (a screenshot);
    2. a stored key set from the page is in `<config-dir>/daemon-state/local.json` within 2 s, and is back after the app is restarted;
    3. `location.href = "https://example.com"` from the page leaves the window on the app;
    4. invoking an unlisted command from the page is refused;
    5. **the HTML preview probe** of the spike, mounted through the page's host: whether scripts run and every isolation attempt fails. The result (`origin` works or not) is printed, not asserted;
    6. a second launch leaves one process.
  - **macOS, through the control socket only:** launch with `--control 0 --config-dir <tmp>`; `ui.inspect` answers; `settings.set` writes `settings.json`; the configuration directory's real default location is printed; the app exits cleanly on quit.
- Checks that need no daemon run without one: the daemon is POSIX-only, so Windows has none, and these checks do not need one on macOS either.
- **`desktop/docs/platform-checks.md`:** mark each item the workflow covers ("automated: Windows", "automated: macOS") so task-002's person skips it, and add how to start the workflow and read its summary.

## Out of scope
- Native dialogs, drags from Finder or Explorer, the macOS dock, SmartScreen, the page on macOS: they stay in the manual checklist.
- Changing a platform's preview kind: task-002 decides from the printed result, with a person confirming it.
- Running on every push: the macOS and Windows runners are slow and costly; this workflow is started on demand.

## Acceptance criteria
- [ ] A run of the workflow is green on both runners, with the screenshots, logs and summary attached.
- [ ] A deliberately broken check (for example, expecting the wrong storage value) turns the Windows job red; reverted afterwards.
- [ ] The summary prints the Windows preview probe result and the macOS configuration directory.
- [ ] `desktop/docs/platform-checks.md` marks the automated items and explains how to start the workflow.
- [ ] `release.yml` is not triggered by this workflow or its files.
- [ ] `cargo xtask ci` passes; the script passes the app's lint.

## Test / verification plan
- A `workflow_dispatch` run on the branch, and a pull-request run that changes the workflow.
- `npm run lint` in `desktop/apps/pistudiodesktop`; `cargo xtask ci` in `desktop/`.

## Notes
- **A run needs the branch on GitHub.** Pushing is the engineer's decision: ask before pushing, and never push to `main`.
- How `tauri-driver` and `msedgedriver` are installed and matched to the runner's WebView2 version is from Tauri's documentation and was not tried here; record what worked in the workflow's comments.
- Task-002 (manual) does not depend on this task, but if this one is done first the person skips every item it marked.
