# Task 004 — Live check: the app updates an outdated local daemon and an SSH one — Summary

- **Sprint:** sprint-138-daemon-update-desktop
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- Rows D-U1..D-U7 on Linux in the real WebKitGTK webview under xvfb with a local verdaccio and an sshd container: local Update (cli_outdated -> running, about 6-7 s), local daemon stopped through the UI -> Update, SSH Update (cli_outdated) and SSH daemon killed -> Update, the pill/dialog update of a running daemon, the same with the helper frozen 8 s, registry stopped (failed(update_failed) with npm's line), read-only npm folder (EACCES lines).
- Five bugs fixed with tests: (1) the page's connect reaction ignored `updating`; (2) SSH `pi-studio update` ran without `-H` and probed the default port (now `pi-studio -H 127.0.0.1:<port> update 2>&1`); (3) a manual disconnect ended `closed` instead of `idle` (late close event; pre-existing, also the browser client); (4) the page stuck on 'Stopped' after a restart gap longer than the probe (the update store remembers an announced `restarting` for 4 min); (5) Update on a failed-update row was refused by the engine (now allowed for local and remote after `update_failed`).

## Files changed
`packages/workbench/src/{features/daemons/daemon-lifecycle.ts(+test),features/connection/daemon-update-store.ts(+test),lib/connection/connection-store.ts(+test),test/reset-stores.ts}`, `desktop/crates/{shell/src/remote_supervisor.rs(+tests),engine/src/{local.rs,remote.rs,remote/tests.rs}}`, `desktop/docs/{platform-checks,development,architecture,control-protocol}.md`, `packages/workbench/AGENTS.md`

## Build & test results
```
Gate: npm run build, typecheck ok; lint 0 errors; npm test -> 318 files / 4542 tests passed; cd desktop && cargo fmt --all && cargo xtask ci -> all 8 steps passed; npm run snapshot ran (snapshot.png restored)
```

## Acceptance criteria
- [x] each row recorded with evidence in `desktop/docs/platform-checks.md`; defects fixed with tests.

## Follow-ups
- Not seen: a truly old CLI (the 'outdated' one is this repo's build relabelled below the minimum), dialog counts with agents or terminals open, an SSH host's daemon on the CLI's default port, the SSH failed-row recovery on the fixed build, a rollback from the app, the browser client in the app run, a network outage mid-install; macOS and Windows (owner's decision).
