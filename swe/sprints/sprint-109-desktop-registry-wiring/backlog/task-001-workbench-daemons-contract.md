# Task 001 — Workbench: the `daemons` host contract and an in-memory registry for tests

- **Sprint:** sprint-109-desktop-registry-wiring
- **Status:** backlog
- **Type:** feature
- **Area:** packages/workbench (host, test)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** sprint-105/task-002

## Goal
`WorkbenchHost` has the optional `daemons` member and `app.minDaemonVersion` as types, exported from the package, with an in-memory implementation that tests can drive. Nothing reads them yet, so both clients behave exactly as before.

## Context / why
The desktop frontend (task-005) and the workbench's screens (sprint-110) are built against this contract by different tasks. Fixing it first, with a working fake, lets both sides proceed and be unit-tested without the other.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Public contract 3 (`HostDaemons`), § Public contract 2 (`EntryView`, `LocalState`, error codes), § Public contract 6
- `swe/architecture/workbench-host-adapter.md` § Amendment (rows `daemons`, `app.minDaemonVersion`)
- `packages/workbench/src/host/types.ts` (`WorkbenchHost`, `AppIdentity`, `ConnectIntent`), `src/index.ts` (exported host types), `src/host/host-members.test.ts`, `src/test/test-host.ts`
- `packages/workbench/README.md` § The host, `packages/workbench/AGENTS.md`

## What to build
- Types, as in the spec's § 3, with these names: `HostDaemons`, `DaemonEntryView` (`{ id, kind, name, address?, hasPassword }`), `LocalDaemonState` (a union on `state`, including `checking`), `NewDaemon`, `DaemonPatch` (`password: string | null` to set or clear), and `DaemonError` (an `Error` with a `code` from the spec's tables plus `no_current` and `local_stopped`).
- Two additions the spec's interface lacks (see Notes):
  ```ts
  // in snapshot():
  settings: { autoStartLocalDaemon: boolean; cliPath: string | null };
  // on HostDaemons:
  setSettings(patch: { autoStartLocalDaemon?: boolean; cliPath?: string | null }): Promise<void>;
  ```
- `AppIdentity.minDaemonVersion?: string`; `WorkbenchHost.daemons?: HostDaemons`.
- **An in-memory registry for tests** in `src/test/`: it implements `HostDaemons` with the spec's rules (name unique without case, the local entry not removable, the error codes), a scripted local daemon (state changes on start, stop, restart), a recorded `switchTo`, and a way to fire a manage request. It is not exported from the package root.
- The test host accepts a `daemons` option; the host-members test covers the new member's presence and absence.
- README and AGENTS host tables gain the two rows, marked "consumed from sprint-110".

## Out of scope
- Any component, hook or store that reads `host.daemons` (sprint-110).
- The desktop implementation (task-005).

## Acceptance criteria
- [ ] The package builds with the new types exported; `createBrowserHost()` returns a host without `daemons` and without `minDaemonVersion`.
- [ ] The in-memory registry: adding "Work" when "work" exists rejects with a `DaemonError` whose code is `name_taken`; removing `local` rejects with `local_not_removable`; subscribers fire once per change; `snapshot()` never contains a password or a pairing link.
- [ ] Its `resolveCurrent` follows the spec's table for the direct, relay and local cases, including `local_stopped` with auto-start off.
- [ ] No file outside `src/host`, `src/test` and `src/index.ts` changed.
- [ ] `npm run build:workbench`, `npm run build:web-client` and the workbench's tests pass.

## Test / verification plan
- `npx vitest run packages/workbench/src/host packages/workbench/src/test`
- `npm run build:workbench && npm run build:web-client`
- `npx oxfmt <changed files>`; `npm run lint`

## Notes
- **Found at planning time:** the spec puts the two settings in the Daemons screen, but `HostDaemons` gives the workbench no way to read or change them. They join the snapshot, with one setter. sprint-111/task-003 records it in the spec.
- Depends on sprint-105/task-002 only because both edit `host/types.ts`, `src/index.ts` and `test/test-host.ts`.
- Shared documents: in a parallel wave, put the README and AGENTS edits in the summary.
