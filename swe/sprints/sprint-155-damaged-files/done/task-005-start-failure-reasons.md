# Task 005 — The desktop app says why a daemon did not start

- **Sprint:** sprints/sprint-155-damaged-files
- **Status:** done
- **Type:** feature
- **Area:** desktop (crates shell and model, the app's host), packages/workbench (Daemons screen)
- **Priority:** P2
- **Estimated size:** M
- **Depends on:** task-003

## Goal
A daemon that refuses to start shows its reason on the Daemons screen, for local and SSH entries.

## Context / why
The handoff's warning on improvement 8: refusing to start is a new failure the CLI and the desktop
Daemons screen must report clearly. Today the desktop reads only `up`, `host`, `port` and `stopped`
from the CLI's JSON line and shows "Started, but not answering" for any failure, so
`unprotected_bind` (M1) is already lost there, and `config_unreadable` would be too.

## Scope references
- `docs/daemon-audit-handoff.md` § "Findings that changed since the audit" (last bullet)
- `desktop/crates/shell/src/cli_answers.rs` (`parse_answer`, `Failure`), `supervisor.rs` (:268,
  :318-335), `desktop/crates/model/src/registry.rs` (`FailReason`)
- `packages/workbench/src/features/daemons/daemon-presentation.ts`,
  `desktop/apps/pistudiodesktop/src/host/daemons.ts` and `daemons-view.ts` (the reason list)
- `desktop/docs/architecture.md`, `desktop/AGENTS.md`

## What to build
- `parse_answer` reads the `error` field of a `{"up": false}` line. `FailReason` gains
  `unprotected_bind` and `config_unreadable`; an unknown code stays "not healthy".
- The Daemons screen shows one sentence per reason and what to do: set a password or bind to
  loopback; repair or remove the config file (with its path on that machine).
- The same for an SSH entry, which runs the same CLI on the host.
- Docs: the two desktop files, and `packages/workbench/AGENTS.md` (Daemons screen).

## Out of scope
New daemon behaviour.

## Acceptance criteria
- [ ] Rust tests: both codes parse to their reasons; an unknown code and a missing field parse as
      before.
- [ ] Presentation tests: each reason has its own text; nothing shows a raw code.
- [ ] `cd desktop && cargo xtask ci` passes.

## Test / verification plan
- `npx vitest run packages/workbench/src/features/daemons desktop/apps/pistudiodesktop`
- `cd desktop && cargo xtask ci`
