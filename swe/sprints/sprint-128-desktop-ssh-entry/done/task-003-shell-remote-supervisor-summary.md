# Task 003 — Shell: the remote daemon's supervisor over a command-runner hook — Summary

- **Sprint:** sprint-128-desktop-ssh-entry
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- `Services::remote_run`: `(command, limit) -> Result<RemoteOutput{status, stdout}, RemoteRunFailure{ExecFailed, NoShell, TimedOut}>`; the hook does the S7 `"$SHELL" -lic` marker wrapping and returns only what lies between the markers. A missing hook is `ExecFailed`. `RemoteOutput`'s `Debug` omits stdout.
- `remote_supervisor.rs`: Probe runs `pi-studio --version` (15 s): 127 gives `NotInstalled`, below `MIN_CLI_VERSION` gives `CliOutdated`, other output `Failed(BadOutput)`, else `Running` when the app's last open connected, `Stopped` otherwise. Start runs the version check, then `pi-studio --json -H 127.0.0.1:<port> daemon start` (90 s) read by `cli_answers` whatever the exit status (`up` -> `Running`, not healthy -> `Failed(NotHealthy)`, unparsable -> `Failed(BadOutput)`); `pairingUrl` is never kept. Logs only the action and the state code.
- `RemoteAccess` trait (`take() -> Vec<RemoteJob>`, `apply(entry, state)`); `pump` works the engine's queue one request at a time.
- Native only (`log` is a native dependency).

## Files changed
`crates/shell/src/{services.rs,lib.rs,remote_supervisor.rs,remote_supervisor/tests.rs}`

## Build & test results
```
cargo test -p pistudiodesktop-shell -> 222 passed (three consecutive runs; one earlier full run showed 1 failure not captured)
cd desktop && cargo xtask ci -> all 8 steps passed; root: npm run build, typecheck ok, lint 0 errors (pre-existing warnings), npm test -> 297 files / 4232 tests passed
```

## Acceptance criteria
- [x] Each state with a scripted hook, the 90 s limit, `pairingUrl` discarded, `no_shell`, `pump` order.

## Follow-ups
- 128/t004 implements `RemoteAccess` over the owner thread, fills `remote_run` over the SSH session with the marker wrapping, and emits `connection_resume` after a successful Start.
