# Task 003 — SSH crate: connect, hops, login and keepalive, against an in-process server — Summary

- **Sprint:** sprint-127-desktop-ssh-client
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- `error.rs`: `Error` with `code()`/`hop()` (`unreachable`, `timeout`, `handshake`, `host_key_unknown`, `host_key_changed`, `auth_failed`, `passphrase_needed`, `key_unreadable`, `forwarding_refused`, `daemon_not_running`, `ssh_lost`, and `known_hosts` for an unreadable known-hosts file); messages hold no host, path or secret.
- `session.rs`: `connect(&Target, &Secrets, &Environment, &[PathBuf], &Limits) -> Result<Session, Error>` through any hops (each over a `direct-tcpip` channel of the previous); 15 s per step, 45 s in all; host key checked in the handler against the known-hosts files (never written); russh keepalive every 15 s, closed after 3 unanswered; `Session::{hops, is_closed, closed, open_tcpip, close}`.
- `login.rs`: agent identities (not with IdentitiesOnly), key files (entry and config, then existing defaults) with the stored passphrase, the password on the final host only; at most 6 attempts per host; precedence `key_unreadable`, `passphrase_needed`, `auth_failed`; key files read on a blocking thread, capped at 256 KiB.
- `agent.rs`: `Agent::{Default, Env, Socket, Disabled}`; Windows tries the OpenSSH pipe, then Pageant (not compiled here).
- `testing.rs` (feature `testing`): in-process `Server` (key/password logins, `Seen`, real `direct-tcpip`, refusal switch, scripted `exec`), `Wire` (a relay that can go silent), `AgentSocket`, fixed-seed keys, `ENCRYPTED_KEY`.

## Files changed
`crates/ssh/src/{lib.rs,error.rs,session.rs,login.rs,agent.rs,testing.rs,fixtures.rs,login/tests.rs,session/tests.rs}`, `crates/ssh/Cargo.toml`

## Build & test results
```
cargo test -p pistudiodesktop-ssh -> 106 passed (5 runs, no flake); --features testing -> 106 passed; clippy clean in every combination; fmt clean; wasm32 check ok; cargo xtask layers ok
(wave gate to follow) cd desktop && cargo xtask ci -> all 8 steps passed; root: npm run build, typecheck ok, lint 0 errors (pre-existing warnings), npm test -> 297 files / 4232 tests passed
```

## Acceptance criteria
- [x] Each login kind, an encrypted key, IdentitiesOnly, the 6-attempt limit, a password never offered to a hop, two hops, unknown/changed host keys, keepalive loss; plus unreachable, handshake failure, step and total limits.

## Follow-ups
- The code `known_hosts` is not in the spec's error table (add it in 130/t002).
- The Windows branch of `agent.rs` was never compiled: the release workflow run in 130 covers it.
- The sub-agent ran one `sed -i` on `login.rs` against the edit-tool rule.
