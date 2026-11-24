# Task 001 — SSH crate: send a file over the connection

- **Sprint:** sprints/sprint-144-desktop-ssh-install
- **Status:** done
- **Type:** feature
- **Area:** desktop (ssh)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
`Session::send(path, source, size, stall, progress)` writes a file on the host through an exec
channel running `/bin/sh -c 'cat > <quoted path>'`, with progress, a stall limit and the exit status
checked.

## Scope references
- `swe/features/desktop-ssh-daemon-install.md` § Public contract (SSH crate), R3
- `desktop/crates/ssh/src/session/channels.rs` (`run` is the pattern), `error.rs` (add `SendError`),
  `testing.rs` (the test server's exec: accept stdin and write it)

## What to build
Open a session channel (step limit), `exec` without the login shell, write the reader in chunks the
channel accepts (russh flow control), send EOF, wait for the exit status; `progress(bytes)` after each
chunk; no chunk accepted for `stall` → kill and `Stalled`; non-zero status → `Rejected {status}`;
lost connection → `Closed`. The path is single-quoted with `'` escaped; nothing is logged.

## Acceptance criteria
- [ ] Tests with the crate's test server: 10 MiB arrive identical; a stalled reader; a non-zero status;
      a path with a quote in it.
- [ ] `cargo xtask ci` green.

## Test / verification plan
- `cargo test -p pistudiodesktop-ssh`; `cargo xtask ci`

## Notes
The real OpenSSH check (and a `ForceCommand` host) is in sprint-145/task-001.
