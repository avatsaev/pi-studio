# Task 006 — Workflow: run the benchmark on a macOS and a Windows runner — Summary

- **Sprint:** sprints/sprint-112-desktop-ipc-benchmark
- **Completed:** 2026-11-21
- **Status:** done (built and linted; the macOS and Windows runs wait for the owner's approval to push, task-007)

## What was implemented
`.github/workflows/desktop-ipc-benchmark.yml`:
- Triggers: `workflow_dispatch` (inputs `runs`, default 3, and `scale`, default 1) and `pull_request` when only this file's path changes (a quick run: runs 1, scale 0.1). No push trigger.
- Matrix `macos-15` (`ipc-bench`) and `windows-latest` (`ipc-bench.exe`), `fail-fast: false`; the same pinned action SHAs as `desktop-platform-checks.yml`; `cargo build --release -p pistudiodesktop-ipc-bench`; no `npm ci`, no machine-policy step.
- A "Runner" step prints CPU model, core count, OS and webview version to the job summary (macOS: `sysctl` and the WebKit framework's `Info` plist; Windows: WMI and the WebView2 `pv` registry value).
- The run step uses `set -o pipefail` and `tee`, so it fails only on the app's exit code; it writes `bench-out/results.json` and `bench-out/bench.log`. An `if: always()` step prints the user agent, Tauri version, the summary rows (median and worst run) and the comparison rows; it judges no threshold. Artifact `ipc-benchmark-<platform>`, uploaded with `if: always()`.
- `desktop/docs/development.md` (section The IPC benchmark) says how to start it and that the first run needs a pull request that changes the workflow file, or the file on `main`, and the owner's word to push.

## Results
```
docker run --rm -v "$PWD:/repo:ro" rhysd/actionlint:latest /repo/.github/workflows/desktop-ipc-benchmark.yml   exit 0 (after a shellcheck disable for SC2016 on the inline node script)
container: ipc-bench --out /out/results.json --runs 1 --scale 0.05 | tee bench.log   "done, every run completed and no frame was damaged"; pipeline exit 0; both files written
the job-summary node script run on that results.json printed both tables
release.yml: push to main only, paths-ignore desktop/** and .github/workflows/desktop-*.yml: neither this file nor apps/ipc-bench can start it
```

## Wave gate (orchestrator, combined tree, 2026-11-21)
```
$ (cd desktop && cargo xtask ci)     all 8 steps passed (fmt, web, clippy, layers, test, panic_hunt, doctest, wasm)
$ npm run build && npm run typecheck && npm run lint && npm test     all exit 0; 291 files, 4132 tests passed
$ (cd desktop/apps/pistudiodesktop && npm run check && npm run lint && npm test)     exit 0; 120 tests passed
```

## Acceptance criteria
All four met.

## Follow-ups / TODO(verify)
- Not run on macOS or Windows. Four runner-only details are untested (the WebKit `Info` plist path, the Windows PowerShell line, the WebView2 registry GUID, the Windows link and runtime of the release build); each is guarded so a miss prints `unknown` or empty rather than failing the job.
- The first run needs a pull request that changes the workflow file (a pull request, and the push, need the owner's word).
