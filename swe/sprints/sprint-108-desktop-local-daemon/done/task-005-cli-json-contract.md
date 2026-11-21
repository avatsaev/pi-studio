# Task 005 — `packages/cli`: pin the output the desktop app reads

- **Sprint:** sprint-108-desktop-local-daemon
- **Status:** done
- **Type:** test
- **Area:** packages/cli
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal
The parts of the `pi-studio` CLI's output that the desktop app depends on are covered by tests named as a contract, so a later change to the CLI cannot break the app silently.

## Context / why
The spec states that this output "is now a contract between `packages/cli` and the desktop app". The `--json` tests of sprint-098 cover `start`, `restart`, `pair` and `stop`. `daemon status --json` has no test, and nothing pins what `--version` prints.

## Scope references
- `swe/features/desktop-daemon-registry.md` § Public contract 7
- `swe/features/desktop-client-protocol-followups-2.md` § 3, `swe/features/cli.md`
- `packages/cli/src/daemon-commands.ts` (`status`, `ensureLocalDaemonAndPair`, `stop`), `packages/cli/src/daemon-commands.test.ts` (`describe("daemon --json")`), `packages/cli/src/program.ts` (`.version(version, "-v, --version")`)
- `packages/cli/AGENTS.md`, `packages/cli/README.md`

## What to build
- Tests, grouped under one description that names the desktop app as the consumer:
  - `--json daemon status` prints exactly one line, a JSON object with `up` (boolean), `host` (string) and `port` (number), both when the daemon is up and when it is down, and its exit code is what it is today in each case;
  - `--json daemon start` and `restart`: the fields `up`, `host`, `port` and, in the two failure shapes, `error` have the types the app reads (the existing tests assert whole lines; this one asserts the fields the app uses, so adding a field does not fail it);
  - `--json daemon stop`: `stopped` is a boolean;
  - `--version` prints one line that is a semantic version and nothing else.
- A short section in `packages/cli/AGENTS.md`: these outputs are read by the desktop app; fields may be added, and the listed ones may not be removed, renamed or retyped without changing the app.

## Out of scope
- Changing any output. If a test shows the CLI does not print what the spec's table says, stop and report: that is a spec question, not a quiet fix.
- The desktop side (the other tasks of this sprint).

## Acceptance criteria
- [ ] The new tests pass against the unchanged CLI.
- [ ] Removing `port` from the `status` output (tried locally, then reverted) fails a test whose name mentions the desktop contract.
- [ ] `packages/cli/AGENTS.md` names the contract and the fields.
- [ ] `npm run build:cli`, `npm run lint` and the CLI's tests pass.

## Test / verification plan
- `npx vitest run packages/cli/src/daemon-commands.test.ts packages/cli/src/program.test.ts` (or where `--version` is tested)
- `npm run build:cli`; `npx oxfmt <changed files>`; `npm run lint`

## Notes
- Independent of every other task in the plan: it can run at any time.
- The root `README.md` and the Fern docs describe user-facing CLI behaviour, which does not change here.
