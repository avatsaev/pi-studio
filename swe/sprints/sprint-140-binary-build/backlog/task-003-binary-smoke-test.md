# Task 003 — The binary's smoke test (`npm run test:binary`)

- **Sprint:** sprints/sprint-140-binary-build
- **Status:** backlog
- **Type:** test
- **Area:** scripts
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
One script starts a built binary in a temporary home and proves the daemon works; the release jobs
run the same script on each system.

## Context / why
A9, P1, P13. The test suite runs on Node; the binary needs its own check.

## Scope references
- `swe/features/single-binary-daemon.md` § Release (smoke test steps)
- Create: `scripts/binary-smoke.mjs`; root `package.json` script `test:binary -- <folder>`

## What to build
With `HOME` and `PI_STUDIO_HOME` in a temporary folder and a free port: `--version` equals the
expected version; `--json daemon start`; `/api/health` gives `{status: ok, version}`; through
`@av-pi-studio/client` from the repo: a mock agent turn (the binary daemon is configured with the mock
provider through `config.json`), a terminal that echoes, a 1 MiB upload and download with equal
hashes; `__pi --version`; `--json daemon stop` and the process gone. Exit code 0 only when all pass;
each step prints one line.

## Out of scope
A real Pi turn (task-004).

## Acceptance criteria
- [ ] Passes against the linux-x64 build; fails with a clear line when the daemon does not start
      (tested by pointing it at a broken folder).

## Test / verification plan
- `npm run build:binary -- --target linux-x64 && npm run test:binary -- dist-binary/pi-studio-<v>-linux-x64`

## Notes
The script runs under Node from the repository (the runner has Node); only the daemon under test is the binary.
