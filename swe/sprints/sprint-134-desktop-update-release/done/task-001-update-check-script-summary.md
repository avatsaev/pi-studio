# Task 001 — The update-check script for the release workflow — Summary

- **Sprint:** sprint-134-desktop-update-release
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- `scripts/platform-checks/update-check.mjs` (+ 30 unit tests): installs an older build per system (AppImage copy, `.deb` through `sudo apt-get install` with a polkit rule it installs and removes, macOS dmg -> /Applications, Windows NSIS /S), starts it with `--update-manifest`, drives `update.check|install|restart` over the control socket, checks version/file change/new pid, then the N->N self check; step time limits; `summary.md`, `results.json`, per-stage logs.
- Local runs on Linux in a container: AppImage 12 steps in 9.4 s, `.deb` 13 steps in 8.2 s; failure cases: slow download hits the 15 s limit, 404 manifest -> `code=offline`, pkexec without a rule -> 127.
- Contract for 134/t002 in the agent's report: `node scripts/platform-checks/update-check.mjs --from <installer> --manifest <latest.json URL> --expect-version <N> [--self-check-manifest <url>]`, or `--self-check --from <N installer> --manifest <self-check.json URL>`; `[--kind] [--install-timeout] [--out]`; exit 0/1/2; Linux under `dbus-run-session -- xvfb-run -a`; AppImage needs libfuse2 or APPIMAGE_EXTRACT_AND_RUN=1; `.deb` needs passwordless sudo, pkexec and a running polkitd.

## Files changed
`desktop/apps/pistudiodesktop/scripts/platform-checks/{update-check.mjs,update-check.test.mjs}`, `desktop/docs/development.md`

## Build & test results
```
Wave gate: cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed; root npm run build, typecheck ok; lint 0 errors; npm test -> 299 files / 4281 tests passed; node --test 'scripts/release/*-test.mjs' 25 passed
```

## Acceptance criteria
- [x] pure parts unit-tested; Linux AppImage and .deb runs against test builds and a local server.

## Follow-ups
- Not run: the macOS and Windows install steps (assumed locations `/Applications/Pi Studio.app/Contents/MacOS/pistudiodesktop` and `%LOCALAPPDATA%\Pi Studio\pistudiodesktop.exe`); polkitd on a GitHub Ubuntu runner; a hung admin dialog beyond the slow-download limit.
- U6 correction (live): the self-check files need a second signature with `--app-version <N next>-selfcheck`, kept as `<file>.selfcheck.sig`; `update-manifest.mjs --self-check` now reads them. `tauri signer sign` always writes `<file>.sig`, so 134/t002 must sign a COPY in a scratch directory and move the result, never the real file.
