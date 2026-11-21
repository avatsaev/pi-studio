# Task 001 — Workbench `daemons` host contract — Summary

- **Sprint:** sprint-109-desktop-registry-wiring
- **Completed:** 2026-11-20
- **Status:** done

## What was implemented
- Contract types in `host/types.ts`:
  - `HostDaemons`
  - `DaemonEntryView`
  - `LocalDaemonState`, with `checking`, `cli_missing{path?}`, `cli_outdated{version}`, `running{host,port}` and `failed{reason}`
  - `NewDaemon`
  - `DaemonPatch`
  - `DaemonSettings`
  - `DaemonErrorCode`
  - `DaemonError`
- `snapshot()` carries `settings`, and `HostDaemons` has `setSettings`.
- `AppIdentity.minDaemonVersion?` and `WorkbenchHost.daemons?` are added.
- All of these are exported as types from `index.ts`. `createBrowserHost` is untouched, so it returns no `daemons` and no `minDaemonVersion`.
- `DaemonError` is an **interface** (`Error` plus `code`), not a class. A class would add a runtime export, and `shell/public-api.test.ts` pins the exact list of runtime exports. Consumers such as task-005 should create their own `Error` objects carrying a `code`.
- `test/test-daemons.ts` holds `createTestDaemons(options)` and a test-only `DaemonError` class:
  - **Validation:** names are trimmed, 1–64 characters, unique without case. There is a 64-entry limit, plus `invalid_address`, `invalid_link`, `not_found`, `wrong_kind` and `local_not_removable`.
  - **Secrets:** `snapshot()` never returns a password or pairing link.
  - **Notifications:** subscribers fire once per change.
  - **Local daemon:** `start` and `restart` set `starting`, then reach `options.startOutcome` (default running on `127.0.0.1:7777`) on a later tick. `stop` goes to `stopping`, then `stopped`. A second action while one runs rejects `busy`. `unsupported`, `cli_missing` and `cli_outdated` reject with that code.
  - **`resolveCurrent`:** follows the spec's table, including auto-start and `local_stopped` with auto-start off. A failed start rejects with the failure reason as the code.
  - **Controls:** `switchTo` is recorded in `switches` and its promise never resolves. `setLocalState`, `requestManage`, `settled()` and `listenerCount()` drive the fake from tests.
- `createTestHost` accepts `daemons` and `minDaemonVersion`.

## Files
| File | Change |
|---|---|
| `packages/workbench/src/host/types.ts` | changed: new types, `AppIdentity.minDaemonVersion`, `WorkbenchHost.daemons` |
| `packages/workbench/src/index.ts` | changed: type exports |
| `packages/workbench/src/test/test-daemons.ts` | created: in-memory registry |
| `packages/workbench/src/test/test-daemons.test.ts` | created: tests for the registry |
| `packages/workbench/src/test/test-host.ts` | changed: `daemons` and `minDaemonVersion` options |
| `packages/workbench/src/host/host-members.test.ts` | changed: presence and absence tests |

## Build & test results
- `npx vitest run packages/workbench`: 1526 tests passed.
- `npm run build:workbench` and `npm run build:web-client`: both pass, and `check-dist` is ok.
- `cd desktop/apps/pistudiodesktop && npm run check`: clean.
- `npx oxfmt` and `npx oxlint` on the changed files: no warnings or errors.

## Acceptance criteria
- [x] The package builds with the new types exported; the browser host is unchanged. Verified by the build, and the host-members test checks that `daemons` and `minDaemonVersion` are absent from the default test host.
- [x] `name_taken`, `local_not_removable`, one notification per change, and no secrets in `snapshot()`. Verified in `test-daemons.test.ts`.
- [x] `resolveCurrent` for direct, relay and local, including `local_stopped`, `cli_missing` and a failed start. Verified in `test-daemons.test.ts`.
- [x] No files changed outside `src/host`, `src/test` and `src/index.ts`.
- [x] Builds and tests pass.

## Follow-ups
- The in-memory registry does not run the pairing-link parser. It only checks that the link is non-empty and at most 4096 characters.

## Proposed doc edits
- **`packages/workbench/README.md` § The host**, table rows:
  - `daemons` — "Optional. The daemon registry (`HostDaemons`): entries, local daemon state, settings, `resolveCurrent`, `switchTo`. Absent in a browser. Consumed from sprint-110."
  - `app.minDaemonVersion` — "Optional. Oldest daemon version the app expects. Consumed from sprint-110."
- **`packages/workbench/AGENTS.md` § host table:** the same two rows.
- **`packages/workbench/AGENTS.md` § Source layout:** add "`test/test-daemons.ts` — in-memory `HostDaemons` for tests (not exported)". Also note that `DaemonError` is exported as an interface only, because `public-api.test.ts` pins the runtime exports.

## Wave gate (orchestrator)
```
npx vitest run packages/workbench: 120 files / 1526 tests passed; build:workbench OK. README + AGENTS host rows updated by the orchestrator.
```
