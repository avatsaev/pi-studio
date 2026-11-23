# Task 001 — Workbench contract: SSH entries, `RemoteDaemonState`, `remote`, `sshHosts` — Summary

- **Sprint:** sprint-129-desktop-ssh-ui
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- `host/types.ts`: `DaemonEntryView` kind `ssh` with `ssh?: SshEntryView`; `SshHostSuggestion`, `RemoteDaemonState`; `NewDaemon` SSH variant and `DaemonPatch` SSH fields (`null` clears); error codes `invalid_host`, `invalid_user`, `invalid_port`, `invalid_path`, `invalid_jump`, `not_installed`, `ssh_config`; `HostDaemons` gains `snapshot().remote`, `remote.start/refresh`, `sshHosts()`.
- Test double stores, validates, patches and resolves SSH entries; options `remote`, `sshHosts`, `remoteStartOutcome`, `setRemoteState()`.
- Compile-forced: workbench `index.ts` exports, messages for the seven codes, an "SSH" kind label in the screen view and the switcher; desktop host `daemons-view.ts` parses `ssh` and `remote`, `daemons.ts` has `remote.start/refresh` (`daemon.remote.*`) and `sshHosts()` (`ssh_config_hosts`).
- `swe/architecture/workbench-host-adapter.md` amended.

## Files changed
`packages/workbench/src/host/types.ts`, `src/index.ts`, `src/test/test-daemons.ts`, `src/features/daemons/{daemon-presentation.ts,daemon-presentation.test.ts,daemons-screen-view.ts,daemon-switcher-presentation.ts}`, `desktop/apps/pistudiodesktop/src/host/{daemons-view.ts,daemons.ts,*.test.ts}`, `swe/architecture/workbench-host-adapter.md`

## Build & test results
```
npm run build:workbench ok; vitest features+test -> 1046 passed; desktop npm run check ok, npx vitest run src -> 121 passed
cd desktop && cargo xtask ci -> all 8 steps passed; root: npm run build, typecheck ok, lint 0 errors (pre-existing warnings), npm test -> 297 files / 4232 tests passed
```

## Acceptance criteria
- [x] Typecheck passes; the test double implements the new members.

## Follow-ups
- The desktop host's `daemons.ts` additions are the minimum the type change forced; 129/t004 completes the SSH handling.
