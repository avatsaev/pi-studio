# Task 001 — SSH crate: resolving a host through `~/.ssh/config`, and the host list — Summary

- **Sprint:** sprint-127-desktop-ssh-client
- **Completed:** 2026-11-22
- **Status:** done (orchestrator)

## What was implemented
- `config.rs`: `resolve(&Entry, &ConfigSource{config, home}, local_user) -> Result<Target, ConfigError>`, `hosts(&ConfigSource)`, `default_identity_files(home)`. `Target` holds host, port, user, `identity_files`, `identities_only`, `agent` (`Default | Disabled | Socket | Env`) and `hops`.
- The entry's user, port, key file and jump list win; hops resolved like hosts, a hop's own `ProxyJump` spliced in front (flat chain, at most 4, a loop is `TooManyHops`); `ProxyCommand` refused for the host and for hops; `ProxyJump none` / `ProxyCommand none` switch off.
- `Match` lines become `Host !*` in the main file (ssh2-config would otherwise leak their lines into the Host block above). Host list: plain `Host` names in file order, at most 256, each once.
- Errors carry a 1-based line; `Display` never prints a host, path or command; the file is read up to 1 MiB; an absent file is an empty config.
- TODO(verify) answered: `IdentitiesOnly`, `IdentityAgent`, `ProxyCommand` are untyped in ssh2-config 0.9 (`unsupported_fields`, lowercase keys, first match wins); `~` is expanded by this module.

## Files changed
`crates/ssh/src/{config.rs,config/tests.rs,lib.rs}`

## Build & test results
```
cargo test -p pistudiodesktop-ssh -> 67 passed (43 in config); clippy, fmt, wasm32 check clean
cd desktop && cargo xtask ci -> all 8 steps passed; root: npm run build, typecheck ok, lint 0 errors (pre-existing warnings), npm test -> 297 files / 4232 tests passed
```

## Acceptance criteria
- [x] Tests from config text: alias, include, the entry winning, `IdentitiesOnly`, `IdentityAgent`, `ProxyJump` with two hops, `ProxyCommand` refused, a malformed file, the host list skipping patterns.

## Follow-ups
- The caller supplies `local_user`; connect must skip default identity files that do not exist; the app maps every `ConfigError` to `ssh_config`.
- A `Match` line inside an included file is not neutralised; an `Include` inside a `Host` block is conditional on that block (as in OpenSSH).
