# Task 003 — SSH crate: connect, hops, login and keepalive, against an in-process server

- **Sprint:** sprint-127-desktop-ssh-client
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/ssh
- **Priority:** P1
- **Estimated size:** L
- **Depends on:** task-001, task-002

## Goal
`connect(target, secrets, known hosts)` opens a session through any hops with the login order of D11 and keeps it alive.

## Context / why
D11, D15, D16, D18, S9, S13, S16. russh has no reconnect and no policy: the order, the attempt limit and the error codes are ours.

## Scope references
- `swe/features/desktop-relay-ssh.md` § 7 (Login, Agent, Keepalive), § Error handling (SSH rows), S9, S13, S16

## What to build
- An in-process SSH server behind a `testing` feature (russh server): key, password and agent-signed logins, `direct-tcpip`, exec, refusal switches.
- Login: agent identities unless IdentitiesOnly, key files (entry, config, defaults) with the stored passphrase, the password on the final host only, at most 6 attempts; codes `auth_failed`, `passphrase_needed`, `key_unreadable`.
- Hops through `direct-tcpip` of the previous hop; per-step 15 s, 45 s in all.
- Keepalive 15 s, closed after 3 unanswered.

## Out of scope


## Acceptance criteria
- [ ] Tests against the in-process server: each login kind, an encrypted key, IdentitiesOnly, the attempt limit, a password never offered to a hop, two hops, an unknown and a changed host key (`host_key_unknown`, `host_key_changed`), a keepalive loss.

## Test / verification plan
- `cd desktop && cargo xtask ci`

## Notes
- Agent tests use a Unix-socket agent in the test (russh's agent server).
