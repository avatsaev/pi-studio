# Task 006 — Live checks of the wiring (Linux webview) and documents — Summary

**Sprint:** sprint-109-desktop-registry-wiring · **Completed:** 2026-11-20 · **Status:** done. Checks 1–10 pass.

## How it was run
`pi-desktop-xvfb` container (host network) with the repository and Node mounted read-only, WebKitWebDriver, the debug binary, `--config-dir` scratch directories, `PI_STUDIO_HOME=/tmp/live/pihome`. The real CLI through a wrapper script (`cliPath`), the sprint-108 fake CLI through a second wrapper whose mode is read from a file. X-display screenshots through `import` and XTest pointer events.

## Evidence
1. **Real CLI.** Launch: `stopped`. `daemon.local.start`: `running`, `127.0.0.1:6767`, 1.24 s end to end; `pi-studio --json daemon status` agreed (`{"up":true,"host":"127.0.0.1","port":6767}`). `daemon.local.stop`: `stopped`, no daemon process left.
2. **Adoption.** Daemon started by the CLI first: refresh gave `running`, one daemon pid before and after; a relaunch of the app also adopted it, still the same pid.
3. **Failures (fake CLI).** `not_healthy` → `failed/not_healthy`; garbage → `failed/bad_output`; `sleep` → `failed/timeout` (the real 5 s status limit; the start limit cannot be shortened in the app, covered by unit tests); version 0.0.118 → `cli_outdated {version}`.
4. **No CLI.** `cliPath` = a missing file → `cli_missing` naming the path (shown on the Daemons screen).
5. **Registry.** Direct entry with a password and a relay entry added: `daemons.json` mode 0600 and holds both; `ui.inspect` and `boot` show `hasPassword: true` and no secret.
6. **Menu.** Screenshot of the open Daemons menu: three entries, the current one checked, "This machine (stopped)", Start enabled, Stop/Restart disabled. Clicking "Box B": a marker set on `window` was gone after the click, `lastUsedId` changed, `boot` returned the new `currentId`.
7. **Per-entry layout.** A key stored on local and another value on Box B: each `boot` after switching returned its own value, and Box B's first boot had none of local's.
8. **Transfers.** With `transfers_set(1)`, a menu switch showed "1 file transfer is still running. Switch anyway?"; Cancel left the marker, `currentId` and `lastUsedId` as they were.
9. **Secrets.** The app's log (56 lines), the daemon log and every control answer captured: no hit for the password, the relay offer, the CLI pairing link or the fake CLI's pairing marker.
10. **Quit.** With a daemon started by the app, closing the app left the daemon running with the same pid. (Closing was a WebDriver session delete, not a window close.)

## Measured
- First `daemon.local.start` with the real CLI: 1.24 s (spec TODO on the 90 s limit: the limit is far above the measurement; keep it).

## Findings
- `PI_STUDIO_LISTEN` does not apply to `pi-studio daemon start`; the daemon always listens on 6767 (documented in `development.md`).
- Side observation: the Daemons screen from sprint 110 renders against the live app and follows state changes (screenshots).

## Documents
`control-protocol.md` (the `daemon.*` commands, the new `ui.inspect` fields, outputs run here), `development.md` (config files, scratch CLI and home, smoke output re-run), `architecture.md` (webview boundary already listed the four page commands and two events; no change). `cargo xtask ci` passes all 8 steps.
