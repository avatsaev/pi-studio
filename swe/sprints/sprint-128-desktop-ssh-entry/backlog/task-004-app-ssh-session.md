# Task 004 — App binary: the shared SSH session, and `transport_open` and the connector for SSH

- **Sprint:** sprint-128-desktop-ssh-entry
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src-tauri
- **Priority:** P1
- **Estimated size:** L
- **Depends on:** task-002, sprint-127/task-004

## Goal
The app opens one SSH session for the current SSH entry, shares it between the page and the engine, and closes it when idle, on switch, on edit and on keepalive loss.

## Context / why
D15, S11, § Opening a connection. The agent socket comes from the login-shell environment (D18).

## Scope references
- `swe/features/desktop-relay-ssh.md` § 7 (the one session), § Opening a connection, § What the engine retries, D15, D18, S11
- `desktop/apps/pistudiodesktop/src-tauri/src/transport.rs`, `transfers/engine.rs`
- `desktop/crates/shell/src/shell_env.rs`

## What to build
- An `SshSessions` owner: one attempt shared by concurrent opens; closed 30 s after its last channel, on `daemon_switch`, on an edit of the entry, on keepalive loss; the next open redials.
- SSH branch of `transport_open` and of the engine's connector: secrets on the blocking pool, `resolve`, `connect`, `open_daemon`, `dial_over` with the daemon password; `daemon_not_running` triggers a probe; success sets `running`.
- The SSH codes and messages, classed for retry.
- The remote-run hook filled over the session.

## Out of scope
- The host-key dialog (t005).

## Acceptance criteria
- [ ] App tests against the in-process server and a stand-in daemon: two opens share one session; idle close after 30 s (short in test); switch closes; the engine retries `daemon_not_running` and stops at `auth_failed`.

## Test / verification plan
- `cd desktop && cargo xtask ci`

## Notes

