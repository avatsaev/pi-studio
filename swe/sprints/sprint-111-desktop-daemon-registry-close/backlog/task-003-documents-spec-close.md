# Task 003 — Documents and spec close for the registry; milestone 1 closed

- **Sprint:** sprint-111-desktop-daemon-registry-close
- **Status:** backlog
- **Type:** docs
- **Area:** swe (specs, MAIN-SCOPE, PLAN), desktop documents, root AGENTS.md, packages/workbench and packages/cli documents, docs/desktop-client-handoff.md
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, sprint-106/task-003

## Goal
The registry spec, the native-host spec, the host adapter contract and every document that describes the desktop app agree with what was built, and desktop milestone 1 is recorded as done for Linux with what remains open.

## Scope references
- `swe/features/desktop-daemon-registry.md` (status line, § Public contract, § Acceptance criteria, § TODO(verify))
- `swe/features/desktop-native-host.md` (the three criteria marked "needs the registry"; § Public contract 1)
- `swe/architecture/workbench-host-adapter.md` (§ Public contract, § Amendment: `daemons`, `app.minDaemonVersion`)
- `swe/MAIN-SCOPE.md`, `swe/sprints/PLAN.md` (sprints 107–111, § Coverage check, § Open questions)
- `desktop/AGENTS.md`, `desktop/README.md`, `desktop/docs/architecture.md`, `desktop/docs/development.md`, `desktop/docs/control-protocol.md`
- Root `AGENTS.md` (the `desktop/` paragraph), `packages/workbench/AGENTS.md`, `packages/workbench/README.md`, `packages/cli/AGENTS.md`, `docs/desktop-client-handoff.md`
- The task-001 summary and, if it ran, task-002's

## What to build
- **Registry spec:** status line; tick each acceptance criterion that passed on Linux with a pointer to its evidence; leave the macOS and Windows parts open, pointing at task-002. Record the decisions taken at planning and during the work, each in its section:
  - `LocalState` has a `checking` value until the first probe ends;
  - `daemon.local.refresh` answers `{ accepted: true }`; every local outcome arrives as a state change;
  - the error text of a `daemon.*` command is the code itself;
  - `HostDaemons` carries the two settings (`snapshot().settings`, `setSettings`);
  - the page reaches engine commands through one allow-listed command, the dial answer through another, a switch through a third; the two events;
  - from the native menu the current entry does nothing;
  - the stop confirm belongs to the caller, and the window reacts to `stopping`;
  - the "pairing link no longer valid" marker is kept in memory;
  - the app reads the CLI's answer whatever its exit code.
  Update each TODO(verify) with what was observed (the start duration against 90 s, the shells tried, `wrong_key` against `daemon_offline`).
- **Native-host spec:** tick the three criteria that needed the registry; the boot snapshot section shows `daemons` and `minDaemonVersion` as built.
- **Host adapter spec:** `daemons` and `app.minDaemonVersion` move from the amendment into the main contract; the amendment section is then history only.
- **Indexes:** the MAIN-SCOPE row and open-checks entries; PLAN's open questions for these sprints.
- **Desktop and repository documents:** "Where it stands" in `desktop/AGENTS.md`; the architecture document (the registry, the supervisor, the native menu, where secrets live and where they may travel, that `*.corrupt-*` files may hold old secrets); the root `AGENTS.md` desktop paragraph; the handoff document: milestone 1 done for Linux, what is open, and that milestone 2 starts with the IPC benchmark.

## Out of scope
- Code. Planning milestone 2.

## Acceptance criteria
- [ ] No acceptance box in either spec is ticked without evidence, and none that failed is ticked.
- [ ] The host adapter spec's main contract matches `packages/workbench/src/host/types.ts` member by member.
- [ ] Every planning-time decision listed above is in the registry spec.
- [ ] No document says the desktop app has no daemon registry, asks for the address after every launch, or lists the registry as not built.
- [ ] `cargo xtask ci` and the root `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` pass on the final tree.

## Test / verification plan
- `rg -n -i "not built|not planned|neither built" swe/features/desktop-*.md swe/MAIN-SCOPE.md docs/desktop-client-handoff.md` and read each hit.
- Compare the host adapter spec with `host/types.ts`.
- The gates named above.

## Notes
- Depends on sprint-106/task-003 because both rewrite the same documents; this one comes second.
- Root `npm run fmt:check` failed on 28 files before any of this work; do not count that against these sprints, and do not reformat them.
