# Task 001 — SSH crate: resolving a host through `~/.ssh/config`, and the host list

- **Sprint:** sprint-127-desktop-ssh-client
- **Status:** done
- **Type:** feature
- **Area:** desktop/crates/ssh
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-124/task-002

## Goal
An entry's host resolves to a target (host name, port, user, key files, agent, hops) the way `ssh` resolves it, and the config's hosts can be listed.

## Context / why
D9, D10, S12. `ssh2-config` gives Host patterns, HostName, User, Port, IdentityFile, ProxyJump and Include; `IdentitiesOnly` and `IdentityAgent` are untyped fields (spec TODO).

## Scope references
- `swe/features/desktop-relay-ssh.md` § 7 (Resolve, Hops), § 3 (`ssh_config_hosts`), D9, D10, S12
- ssh2-config docs (docs.rs, 0.9)

## What to build
- `resolve(entry fields, config path, home) -> Target` with hops (at most 4) resolved the same way; the entry's fields win.
- `ProxyCommand` for the host, or a file that does not parse: `ssh_config` with the line.
- `hosts(config) -> Vec<HostSuggestion>`: names without wildcards, in file order, at most 256, with their resolved fields.

## Out of scope
- Network.

## Acceptance criteria
- [ ] Tests from config text: an alias; an include; the entry winning; `IdentitiesOnly` and `IdentityAgent`; `ProxyJump` with two hops; `ProxyCommand` refused; a malformed file; the host list skipping `*` patterns.

## Test / verification plan
- `cd desktop && cargo xtask ci`

## Notes
- Resolve the spec's TODO on the untyped fields here.
