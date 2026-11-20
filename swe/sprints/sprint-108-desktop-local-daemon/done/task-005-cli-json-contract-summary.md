# Task 005 — CLI JSON contract tests — Summary
- **Sprint:** sprints/sprint-108-desktop-local-daemon
- **Completed:** 2026-11-20
- **Status:** done

## What was implemented
Six tests in `describe("desktop app contract: CLI output read by the desktop app")`. Each one:
- `--json daemon status` when up: one line with `up` true, `host` a string, `port` a number; exit 0.
- `--json daemon status` when down: the same fields, `up` false; exit 1.
- `--json daemon start` and `restart` success: `up` true, `host` a string, `port` a number, `pairingUrl` a string.
- `--json daemon start` and `restart` failure shapes (`not_healthy` and `no_keypair`): `up`, `host` and `port` typed as above, `error` a string, exit 1.
- `--json daemon stop`: `stopped` is a boolean, both when a daemon was stopped and when none was found.
- `--version`: stdout is exactly one semver line and stderr is empty. The test captures commander's output with `configureOutput`.

The tests assert field types, not whole lines, so adding a field does not fail them. I also added a "Desktop app contract" section to `packages/cli/AGENTS.md`.

## Files created / changed
| File | Change |
|---|---|
| `packages/cli/src/daemon-commands.test.ts` | appended the contract `describe` and an `onlyJsonObject` helper |
| `packages/cli/AGENTS.md` | new "Desktop app contract" section before "Testing" |

## How it satisfies the scope
CLI behaviour is unchanged, and the CLI printed what the spec's table says in every case, so there was nothing to report as a spec question. I checked `git diff --stat` on `daemon-commands.ts` after the revert and it showed no change.

## Build & test results
```
$ npx vitest run packages/cli/src
Test Files  19 passed (19)   Tests  279 passed (279)
$ npm run build:cli      -> ok
$ npx oxfmt packages/cli/src/daemon-commands.test.ts -> ok
$ npm run lint           -> warnings only, none in packages/cli; the four shown are in packages/client and packages/server
```
Mutation check: I removed `port` from the `status` output locally, which failed 2 tests (the up and down `status` ones). Their names start with "desktop app contract". I then reverted the change.

## Acceptance criteria
- [x] The new tests pass against the unchanged CLI (vitest, 279 passed).
- [x] Removing `port` from `status` fails tests named for the desktop contract (mutation check above).
- [x] `packages/cli/AGENTS.md` names the contract and the fields.
- [x] `npm run build:cli`, `npm run lint` and the CLI's tests pass.

## Follow-ups / TODO(verify)
none

## Proposed doc edits for the orchestrator
none

## Wave gate (orchestrator)
```
Wave gate: npm run build OK; npm run typecheck OK; npm run lint OK (exit 0); npm test 276 files / 3913 tests passed. Workbench doc edits applied by the orchestrator (AGENTS.md host section + file-link render layer, README host table).
```
