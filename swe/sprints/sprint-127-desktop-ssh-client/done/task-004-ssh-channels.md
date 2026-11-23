# Task 004 — SSH crate: the daemon channel, `dial_over`, and remote commands

- **Sprint:** sprint-127-desktop-ssh-client
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/ssh
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-003, sprint-124/task-004

## Goal
A session opens the daemon's WebSocket over `direct-tcpip` as a `DaemonSocket`, and runs a command with markers, a limit and bounded output.

## Context / why
D21, S7, § 8. The refusal from the daemon's port and the refusal from the server's rules give different codes.

## Scope references
- `swe/features/desktop-relay-ssh.md` § 7 (`open_daemon`, `run`), § 8, D21, S7

## What to build
- `Session::open_daemon(port)`: `direct-tcpip` to `127.0.0.1:port`; connection refused gives `daemon_not_running`, administratively prohibited gives `forwarding_refused`; then `net::dial_over` with `ws://127.0.0.1:<port>`.
- `Session::run(command, limit) -> { status, stdout }`: one exec channel, `"$SHELL" -lic` with random begin and end markers, stdout up to 64 KiB, stderr dropped, killed at the limit; no marker gives `no_shell`.
- Several channels on one session at once.

## Out of scope


## Acceptance criteria
- [ ] Tests: a WebSocket through the in-process server to a stand-in daemon; both refusals; two channels at once; `run` returning status and output between markers, cut at 64 KiB, stopped at its limit, and `no_shell` when the server runs no command.

## Test / verification plan
- `cd desktop && cargo xtask ci`

## Notes

