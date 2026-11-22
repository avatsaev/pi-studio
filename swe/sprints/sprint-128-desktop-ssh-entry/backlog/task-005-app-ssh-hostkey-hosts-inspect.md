# Task 005 — App binary: the host-key dialog, `ssh_config_hosts`, and `ui.inspect`

- **Sprint:** sprint-128-desktop-ssh-entry
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/apps/pistudiodesktop/src-tauri, desktop/crates/shell (transports view)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-004

## Goal
An unknown host key is asked about in a native dialog after the failed connect, the page can list the config's hosts, and `ui.inspect` shows how each connection goes.

## Context / why
S6, S12, § 11.

## Scope references
- `swe/features/desktop-relay-ssh.md` § An unknown host key, § 3 (`ssh_config_hosts`), § 11, S6, S12
- `desktop/crates/shell/src/services.rs` (`ConfirmHook`)
- `desktop/crates/shell/src/transports.rs`

## What to build
- On `host_key_unknown`: one native confirm per key per page load with host, port, key type, SHA-256 fingerprint, and whether it is a jump host; Trust appends to the app's `known_hosts` and emits `connection_resume`; Cancel is remembered until boot or switch. A changed key has no dialog.
- `ssh_config_hosts` page command (manifest, capability, `generate_handler!`, the capability-list test).
- `ui.inspect`: `transports[i].via`, `ssh { state, hops, channels }`; nothing identifying.

## Out of scope


## Acceptance criteria
- [ ] App tests with the confirm hook scripted: Trust stores and resumes; Cancel suppresses a second question; `ssh_config_hosts` answers the list; `ui.inspect` shows `via` and the session counts.

## Test / verification plan
- `cd desktop && cargo xtask ci`

## Notes

