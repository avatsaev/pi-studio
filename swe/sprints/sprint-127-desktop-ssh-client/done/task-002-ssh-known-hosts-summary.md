# Task 002 — SSH crate: known hosts in `~/.ssh/known_hosts` and the app's file — Summary

- **Sprint:** sprint-127-desktop-ssh-client
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- `known_hosts.rs`: `check(host, port, &PublicKey, &[&Path]) -> Result<HostKeyStatus, KnownHostsError>` (`Known | Unknown | Changed`) and `trust(host, port, &PublicKey, app_file)`; both return a `Result` (an unreadable existing file fails the check; `trust` needs the error).
- Matching: plain names, `[host]:port` (22 is the bare name), hashed `|1|` entries (HMAC-SHA1), `*`/`?`, `!` negation, case-insensitive; `@revoked` gives `Changed`; `@cert-authority` ignored; malformed or over-long (16 KiB) lines skipped; files read up to 16 MiB.
- `trust` appends `<host or [host]:port> <type> <key>` without the comment, creates the file mode 0600, adds a newline if needed, and refuses names that would corrupt the file (`InvalidHost`).
- TODO(verify) answered: `russh::keys::known_hosts` reads hashed and `[host]:port` entries, but one malformed line fails the whole check, `@revoked` is ignored, wildcards and negation are not handled and names are compared case-sensitively: the lookup is written here.
- `ring = "0.17"` pinned in the crate (already in the tree); dev-dependency `tempfile`.

## Files changed
`crates/ssh/src/{known_hosts.rs,known_hosts/tests.rs,lib.rs}`, `crates/ssh/Cargo.toml`

## Build & test results
```
cargo test -p pistudiodesktop-ssh -> passed (24 in known_hosts at the time); clippy, fmt, wasm32 check clean
cd desktop && cargo xtask ci -> all 8 steps passed; root: npm run build, typecheck ok, lint 0 errors (pre-existing warnings), npm test -> 297 files / 4232 tests passed
```

## Acceptance criteria
- [x] Plain, hashed and `[host]:port` entries; a changed key; a second key type; append and re-read; `~/.ssh/known_hosts` never written (content and mtime unchanged).

## Follow-ups
- Sprint 128's dialog maps `Changed` (also a revoked key) to `host_key_changed`; the caller passes the key's own host and port.
