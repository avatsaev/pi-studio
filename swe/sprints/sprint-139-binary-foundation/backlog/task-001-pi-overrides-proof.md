# Task 001 — Pi's settings replaced in-process, proven inside a compiled binary (gate)

- **Sprint:** sprints/sprint-139-binary-foundation
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (runtime), Pi integration
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** none

## Goal
`packages/server/src/runtime/pi-overrides.ts` makes Pi use the `bun` script as its package manager and
skip the packages in `BINARY_EXCLUDED_PACKAGES`, without writing Pi's `settings.json`, and a scratch
compiled binary proves both work.

## Context / why
Grill open question 3 and P8, D2. The binary shares the user's Pi folder (D8); it must not rewrite
the user's Pi settings. On Node, replacing `SettingsManager.prototype.getNpmCommand` made Pi's
`DefaultPackageManager` use the given command (2026-11-24). Not shown inside a compiled binary, and
not shown for filtering the package list. **This task is the milestone's gate: if either replacement
does not work in the compiled binary, stop, record what was seen, and go back to the owner before any
other task of milestone 6 starts.**

## Scope references
- `swe/architecture/single-binary-daemon.md` § Pi's settings (A6), § Decisions (A1)
- `swe/features/single-binary-daemon.md` § Pi in the binary, § TODO(verify)
- `node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js`, `dist/core/package-manager.js`, `dist/bun/cli.js`
- Create: `packages/server/src/runtime/pi-overrides.ts`, `packages/server/src/runtime/pi-overrides.test.ts`
- Create: `packages/server/src/runtime/excluded-packages.ts` (`BINARY_EXCLUDED_PACKAGES`)
- Root `package.json`: `bun` as an exact-pinned devDependency (A1; 1.4.5 unless the proof needs another)

## What to build
- `applyPiOverrides({ bunScript, excluded })`: replace `getNpmCommand` to answer `[bunScript]`; wrap
  the `SettingsManager` method Pi uses for the configured package list (find it in Pi 1.4.0) so
  entries whose source is in `excluded` (matched by Pi's identity, `identityOf` in
  `curated-packs.ts`) are dropped. Idempotent. Nothing is written to disk.
- Unit tests on Node against Pi's real `SettingsManager`/`DefaultPackageManager` in a temporary agent
  dir: the package manager name is `bun`, an excluded package is not in the resolved list, the
  settings file is byte-identical.
- The proof (scratch, not committed beyond a script under `packages/server/scripts/`): a tiny entry
  that calls `applyPiOverrides` then imports Pi's `dist/bun/cli.js`, compiled with
  `npx bun build --compile`; a `bun` script beside it (`BUN_BE_BUN=1 exec …`). In a container with no
  Node or npm on `PATH`: `pi install npm:<small extension>` installs it and Pi loads it; with
  `npm:@99percentpeople/pi-background-tasks` installed in the settings, `pi --mode rpc` starts and does
  not load it; `settings.json` hashes equal before and after.

## Out of scope
Using the overrides in the daemon or the real binary (sprint-140). The sync planner (sprint-140/task-002).

## Acceptance criteria
- [ ] Unit tests pass on Node.
- [ ] The compiled scratch binary installs an extension with no npm on the machine; `settings.json`
      is unchanged.
- [ ] The compiled scratch binary starts Pi with the excluded package installed and does not load it.
- [ ] The summary records the Pi method wrapped and the evidence; a failure is reported to the owner
      and the sprint stops.

## Test / verification plan
- `npx vitest run packages/server/src/runtime/pi-overrides.test.ts`
- The scratch build and container run, commands and outputs in the summary.

## Notes
This becomes a fifth place that mirrors Pi internals; root `AGENTS.md` § Pi dependency posture is
amended in sprint-145/task-002.
