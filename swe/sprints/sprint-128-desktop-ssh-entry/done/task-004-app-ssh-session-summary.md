# Task 004 — App binary: the shared SSH session, and `transport_open` and the connector for SSH — Summary

- **Sprint:** sprint-128-desktop-ssh-entry
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- `src-tauri/src/ssh_session.rs`: `SshSessions` holds one session for the current SSH entry; concurrent opens share one attempt; a failed or ended attempt is not reused. Every channel (the page's, the engine's, a remote command) holds a lease; the session closes 30 s after the last lease ends, on `daemon_switch`, when the entry is edited or removed, when keepalive finds it dead, and at app exit; a close ends any open or running call at once. Secrets are read on the blocking pool, config resolved, then `ssh::connect`; the agent socket comes from the login-shell environment; known hosts are `~/.ssh/known_hosts` plus `<config dir>/known_hosts`. `daemon_not_running` triggers one probe per outage; a successful open sets the remote state `running`.
- `Route` gets `Way::Ssh` in `transport_open` and the engine connector (the same `SshSessions`, so the page and the engine share one connection); the stopgap is gone. Retry classes confirmed by tests (`daemon_not_running`, `ssh_lost` retried; `auth_failed`, `host_key_unknown`, `host_key_changed`, `ssh_config` final).
- Remote-run hook over the shared session; `main.rs` sets `services.remote_run` and starts a `RemoteSupervisor` on the runner thread; `daemons::RemoteOwner` implements `RemoteAccess` (adds the daemon port and "last open reached the daemon") and fires `connection_resume` (reason `network`) after a successful Start.
- Shell crate, additive (approved): `LocalOp::Ssh(SshOp::{Plan,Take,Apply,Set})` and JSON helpers, `wrong_kind` in `static_code` (`daemons.rs`); `ssh_plan`, `ssh_secrets`, `remote_requests`, `apply_remote`, `set_remote` (`owner_access.rs`); `Notify::ssh_closed` and `local_work` also fired on pending remote requests (`owner.rs`); tests in all three.

## Files changed
`apps/pistudiodesktop/src-tauri/{Cargo.toml,src/ssh_session.rs,src/main.rs,src/daemons.rs,src/commands.rs,src/transport.rs,src/transfers.rs,src/transfers/engine.rs,src/services.rs,src/commands/tests.rs,src/commands/tests/ssh_tests.rs}`, `crates/shell/src/{daemons.rs,owner_access.rs,owner.rs}`

## Build & test results
```
cargo test -p pistudiodesktop -> 153 passed (25 new SSH tests, 3 runs stable); cargo test -p pistudiodesktop-shell -> 225 passed (10 supervisor tests failed once on a first run under load and passed on rerun: not investigated)
cd desktop && cargo xtask ci -> all 8 steps passed; root: npm run build, typecheck ok, lint 0 errors (pre-existing warnings), npm test -> 297 files / 4232 tests passed
```

## Acceptance criteria
- [x] Two opens share one session; idle close (400 ms in test); switch, edit and keepalive loss close it; the engine retries `daemon_not_running` (a wake ends the wait) and stops at `auth_failed`; a Probe and a Start run over the same session with no secret or remote output in the log.

## Follow-ups
- 128/t005: `host_key_unknown` carries only a message; the dialog needs host, port and key in a structured error; `SshSessions` has no inspect counters yet.
- Docs (`desktop/AGENTS.md`, `docs/architecture.md`): new module `ssh_session`, `LocalOp::Ssh`, `Notify::ssh_closed`, the SSH codes -> 130/t002.
- Flaky: shell supervisor tests failed 10 at once on one run under load.
