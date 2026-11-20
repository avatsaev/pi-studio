# Task 004 — Automated platform checks on macOS and Windows runners (native host) — Summary

- **Sprint:** sprints/sprint-106-desktop-native-host-close
- **Completed:** 2026-11-20
- **Status:** done. Built together with sprint-111/task-004 (one workflow, one script).

## What was implemented
`.github/workflows/desktop-platform-checks.yml` builds a debug app on `macos-15` and `windows-latest` and runs `apps/pistudiodesktop/scripts/platform-checks.mjs`. The macOS job drives the app through the control socket and its files (WKWebView has no WebDriver); the Windows job drives the page through tauri-driver and msedgedriver. Each job writes `summary.md`, `results.json`, logs and screenshots (artifact `platform-checks-<os>`) and appends the summary to the job summary. It runs on `workflow_dispatch` and on a pull request that changes the workflow file; never on a push to `main`.

## Files created / changed
| File | Change |
|------|--------|
| `.github/workflows/desktop-platform-checks.yml` | created; a machine-policy step for the elevated Windows runner |
| `desktop/apps/pistudiodesktop/scripts/platform-checks.mjs`, `scripts/platform-checks/*` | created (args, report, wait, probe, control client, shell profiles, macOS and Windows runs, WebView2 diagnostics) with 98 unit tests |
| `desktop/docs/platform-checks.md` | automated section, first results, what it covers |
| `desktop/docs/development.md` | how to run the script (`macos`, `windows`, `rehearse-webdriver`) |
| `desktop/apps/pistudiodesktop/src-tauri/src/commands/tests.rs` | a race in `one_add_is_one_event_with_the_view_and_no_secret` the gate hit (the owner tells after it answers) |
| specs, handoff, `desktop/AGENTS.md`, `desktop/README.md`, root `AGENTS.md` | "macOS and Windows have not run" → only the automated checks have |

## Build & test results
```
Run 44835263318 (pull request #59, commit 5751855)
  macOS (control socket)   14 passed, 0 failed, 0 skipped
  Windows (WebDriver)      10 passed, 0 failed, 0 skipped
Run 44835263462 Desktop CI (cargo xtask ci)   success
$ npm run lint (desktop/apps/pistudiodesktop)   0 warnings;  vitest: 98 passed
```
Negative control: run 44833729601 (commit eba9d04, a deliberately wrong stored-value expectation): Windows job red on exactly `windows.storage-persist`, the other nine passed; reverted in 5751855.

## What the first runs found (all fixed in this task)
1. **msedgedriver splits `args`.** `["--config-dir", dir]` reached the app as `--c:\...` and it exited at once. The app is now given `--config-dir=<dir>` as one argument.
2. **WebView2 150+ ignores `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` when the app is elevated**, and runners are elevated, so msedgedriver's debugging port never opened ("DevToolsActivePort file doesn't exist"). Probes showed neither the port flag nor an unrelated switch reached the browser's command line, also with msedgedriver run directly. Microsoft's stated channel for an elevated host is the HKLM policy (WebView2Feedback#5645, wry#1782): the workflow writes `HKLM\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments` for `pistudiodesktop.exe` as `--remote-debugging-port=0`. No app code changed.
3. **A cold CLI is slow on macOS.** The real CLI's first `--version` took longer than the app's 5 s limit once (`failed`/`timeout` under zsh), 2.4 s in the green run; locally 0.34 s. The check now runs it once first and prints the time. The app's limit is unchanged (a spec decision; the screen offers Retry).
4. **A flaky test the Desktop gate hit** (`one_add_is_one_event_with_the_view_and_no_secret`): it counted the event before the owner thread sent it. Fixed by sending a second request first; reproduced with an 80 ms delay between answer and event (old test fails, new passes), delay removed.

## Printed facts
Windows (WebView2 157.0.4341.46): preview kind `inert`, `preview_mount` refused, the `srcdoc` probe blocks scripts, `origin` **not measured** (needs an app change). macOS 15.8.2: default configuration directory `~/Library/Application Support/com.avatsaev.pi-studio`. `daemons.json` on Windows is in the `--config-dir` used.

## TODO(verify) — settled and still open
- Settled: Command-Q through System Events works on the runner; zsh and bash print their environment without a terminal within 5 s; the default macOS directory; tauri-driver 2.1.0 with the matching msedgedriver (157) and the policy step; the first Windows boot takes about 1 s; second launch exits on its own.
- Open: that a window opens on macOS (the control socket answers either way); the Windows default configuration directory; whether `origin` works on WebView2; a launch from the Dock (manual, sprint-106/task-002).

## Notes
`tauri-driver --version` exits 1 (the summary shows "not available"); sessions go through it. The workflow could not be started with `workflow_dispatch` until the file is on `main`; the pull request was the way. Nothing was merged; the pull request is a draft.
