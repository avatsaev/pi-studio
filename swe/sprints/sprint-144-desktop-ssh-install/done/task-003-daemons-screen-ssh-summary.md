# Task 003 — The Daemons screen's SSH row — Summary

- **Sprint:** sprint-144-desktop-ssh-install
- **Completed:** 2026-11-24
- **Status:** done

## What was built
Install for `not_installed`; the stage and a percentage while installing (once `done`/`total` are known); the reason and Retry on failure (Retry calls Install after an install failure, else Start); Update for `outdated`/`stopped`; "This system is not supported (<system>)" with no button for `unsupported`. The npm instructions and constants (`REMOTE_INSTALL_COMMAND`, `UPDATE_CLI_COMMAND`, `INSTALL_CLI_COMMAND`, `MIN_REMOTE_CLI_VERSION`, `command` fields) are gone from the SSH row, banner and notices. `host/types.ts`, `index.ts` (`RemoteInstallStage`), `HostDaemons.remote.install`, the `install_not_offered` code, `remoteNeedsScreen`; desktop `daemons-view.ts` parses the new remote states, `daemons.ts` wires `daemon.remote.install`. Tests for every remote state in the workbench and the desktop frontend.

## Results
`npx tsc -b --force` clean; workbench 1976 tests; desktop frontend `check`/`lint` clean, `npm test` 371; oxfmt clean on both trees. Sprint gate: see sprint report.

## Acceptance
- [x] Presentation and host tests for every remote state; `daemon.remote.install` wired. [x] Workbench tests and `cargo xtask ci`.

## Not changed / follow-ups
The daemon-update dialog (`MANUAL_UPDATE_COMMAND`, "not installed with npm install -g") and `DAEMON_UPDATE_HINT` in `outdated-daemon.ts` still mention npm (daemon self-update feature, not the SSH row): reconsider at 145/002. `desktop/docs/platform-checks.md` historical D-U/S4 npm-era rows left as records. `not_installed` keeps the error tone in the switcher. Live look: 145/001.
