# Task 004 — `daemon_resolve_current` no longer returns a password

- **Sprint:** sprint-116-desktop-bridge-wiring
- **Status:** backlog
- **Type:** feature
- **Area:** desktop/crates/shell, desktop/apps/pistudiodesktop
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-003

## Goal
For a local or direct entry the page is told what to dial and nothing secret.

## Context / why
The purpose of moving the socket: the password stays in Rust. After this task the only secret a command returns is a relay entry's pairing link, until milestone 4.

## Scope references
- `swe/features/desktop-transport-bridge.md` § 4 (the last paragraph), § Acceptance criteria (Bridge, first item)
- `desktop/crates/shell/src/daemons.rs` (`dial_for_page`), `tests/secret_guard.rs`
- `desktop/apps/pistudiodesktop/src/host/daemons.ts`
- `desktop/docs/architecture.md` (the command table, § Secrets), `desktop/AGENTS.md` rule 10

## What to build
- The answer for a `local` or `direct` entry is `{ url, connect: true }`. A relay entry's is unchanged.
- The secret guard test asserts that a marker password reaches no page answer, event or log line, through every command, the supervisor and a bridged connect.
- The two documents say which secret still reaches the page and why.

## Out of scope
- Relay entries.
- The workbench: `ConnectIntent.password` stays optional and is simply absent.

## Acceptance criteria
- [ ] The dial answer for a direct entry with a password has no `password` field, and the window still connects to a password-protected daemon in the container.
- [ ] The guard test fails if the field is put back.
- [ ] `cargo xtask ci` passes; the app's `npm test` passes.

## Test / verification plan
- `cargo test -p pistudiodesktop-shell -p pistudiodesktop`
- `cargo xtask ci` in `desktop/`

## Notes
- Do this only after task-003: before it, the page still needs the password to connect.
