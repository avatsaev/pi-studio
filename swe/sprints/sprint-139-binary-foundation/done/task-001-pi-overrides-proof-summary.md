# Task 001 — Pi's settings replaced in-process, proven inside a compiled binary (gate) — Summary

- **Sprint:** sprint-139-binary-foundation
- **Completed:** 2026-11-24
- **Status:** done (orchestrator). **The gate passed.**

## What was implemented
- `runtime/pi-overrides.ts`: `applyPiOverrides({SettingsManager, DefaultPackageManager}, {bunScript, excluded})`. `getNpmCommand` answers `[bunScript]`; `DefaultPackageManager.resolve()` runs inside an `AsyncLocalStorage` scope and the settings reads made inside it (`getGlobalSettings`, `getProjectSettings`) leave out excluded `packages` entries (matched by identity, version stripped, string and object entries). Idempotent; nothing is written to disk.
- **Pi method chosen:** `resolve()` is the one place Pi turns configured packages into what it loads and installs what is missing (`dist/core/package-manager.js`, Pi 1.4.0). Wrapping the settings getters globally was rejected: `addSourceToSettings`/`removeSourceFromSettings` read the same getters and a write would then drop an excluded entry from the user's `settings.json`.
- `runtime/excluded-packages.ts`: `BINARY_EXCLUDED_PACKAGES`.
- `extensions/pi-source.ts` (+ test): `parseSource`/`identityOf`/`splitGitRef`/`ParsedSource` moved out of `curated-packs.ts` (importers `sync-planner`, `resource-service`, `skill-catalog`, the tests updated; no re-export). Found by the proof: `curated-packs.ts` imports `version.ts`, whose `createRequire("../package.json")` fails inside the compiled binary.
- Root `package.json`: `bun` 1.4.5, exact (A1); lockfile gained Bun's platform packages.
- Proof: `packages/server/scripts/pi-overrides-proof/{entry.ts,run.sh,container-steps.sh}`.
- Found and fixed: `packages/cli/src/update-commands.test.ts` built its context without a daemon runtime, so tests that reach the restart step used the **real** daemon runtime and restarted whatever daemon ran on this machine (it restarted the developer's own 0.0.130 daemon during this task's first full run). `ctxWith` now defaults to an inert fake. This is a defect from milestone 5b.

## Evidence (linux-x64, Bun 1.4.5, `debian:bookworm-slim`, no Node, no npm)
```
ok:   no node, no npm on PATH
ok:   pi install npm:@99percentpeople/pi-background-tasks (installed on disk and in settings)
ok:   pi install npm:@juicesharp/rpiv-todo with no npm on the machine
ok:   settings.json differs only by the added entry; no npmCommand; the excluded entry is kept
ok:   pi --mode rpc starts with the excluded package installed and answers get_state
ok:   the other extension (rpiv-todo) is loaded: its command is listed
ok:   no node-pty load error: the excluded package was not loaded
control (PI_PROOF_NO_EXCLUDE=1): Error: Failed to load extension ".../pi-background-tasks/index.min.js": Cannot find module 'node-pty'
```
Binary: 122,722,480 bytes (122 MB, unpacked, with the proof entry only).

## Files changed
`packages/server/src/runtime/{pi-overrides.ts,pi-overrides.test.ts,excluded-packages.ts}`, `packages/server/src/extensions/{pi-source.ts,pi-source.test.ts,curated-packs.ts,curated-packs.test.ts,sync-planner.ts}`, `packages/server/src/resources/{resource-service.ts,skill-catalog.ts}`, `packages/server/scripts/pi-overrides-proof/*`, `packages/cli/src/update-commands.test.ts`, `package.json`, `package-lock.json`, `packages/server/AGENTS.md`, `AGENTS.md` (five Pi mirrors), `swe/architecture/single-binary-daemon.md`, `swe/features/single-binary-daemon.md`, task files of 139/001 and 140/004.

## Build & test results
```
npm run build, typecheck: ok; npm run lint: 0 errors (warnings pre-existing); npm test: 320 files / 4550 tests passed
npx vitest run packages/server/src/runtime: 8 tests (Pi's real SettingsManager/DefaultPackageManager)
fmt:check lists 28 files, none touched by this task (pre-existing)
```

## Acceptance criteria
- [x] Unit tests pass on Node.
- [x] Compiled scratch binary installs an extension with no npm; `settings.json` gains only the installed entry (no `npmCommand`, nothing removed). The spec said "byte-identical": that was wrong, `pi install` adds its entry by design; spec and task wording corrected.
- [x] Compiled scratch binary starts Pi with the excluded package installed and does not load it; the control fails as the spec predicted.
- [x] Method wrapped and evidence recorded above.

## Follow-ups
- The daemon (in-process `SettingsManager`/`DefaultPackageManager` in `resources/pi-sdk.ts`) must call `applyPiOverrides` at start: sprint-140/task-001.
- `resolve()` is also reached by `pi update`/`checkForAvailableUpdates` only through other methods, which are not filtered: harmless.
- The daemon's Settings → Skills list still shows an excluded package as configured (it reads `listConfiguredPackages`).
