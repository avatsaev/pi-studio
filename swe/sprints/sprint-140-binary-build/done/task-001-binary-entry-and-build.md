# Task 001 — The binary's entry, its sub-commands and `npm run build:binary`

- **Sprint:** sprints/sprint-140-binary-build
- **Status:** done
- **Type:** feature
- **Area:** packages/cli, packages/server, scripts
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** sprint-139/task-001, sprint-139/task-002, sprint-139/task-003, sprint-139/task-004

## Goal
`npm run build:binary -- --target <target>` produces `dist-binary/pi-studio-<version>-<target>/` and its
tar.gz; the executable is the whole CLI and starts the daemon, Pi, `skills`, the relay and the update
helper through hidden sub-commands.

## Context / why
A1, A2, A7, P4, S4. The spike built only the daemon.

## Scope references
- `swe/architecture/single-binary-daemon.md` § The build, § The sub-commands, § The runtime seam, § Install kind and paths
- `swe/features/single-binary-daemon.md` § Public contract 2, S2, S4
- Create: `packages/cli/src/binary-main.ts`, `scripts/build-binary.mjs`; root `package.json` script `build:binary`; `.gitignore` `dist-binary/`
- `packages/server/src/update/install-kind.ts` (the `binary` value when `isBinary`; whether it can
  update is sprint-142)
- `packages/server/src/daemon/` (import Pi's `dist/bun/runtime-setup.js` and `applyPiOverrides` at start when `isBinary`)

## What to build
- `binary-main.ts`: dispatch on `argv[2]`: `__daemon <json>` → `runDaemon`; `__relay <json>`; `__pi …`
  → `applyPiOverrides` then Pi's `dist/bun/cli.js`; `__skills …`; `__update-helper <json>` (a stub that
  exits with an error until sprint-142/task-003); otherwise the CLI program.
- `build-binary.mjs`: `bun build --compile --target=bun-<os>-<arch> --define PI_STUDIO_BINARY=true`,
  Pi's two worker files as extra entries, `autoloadBunfig`/`autoloadDotenv` off; assemble `pi-studio`,
  the `bun` script, Pi's runtime assets and `web/` from `packages/web-client/dist/web`; tar.gz. Targets
  `linux-x64`, `linux-arm64`, `darwin-arm64`, `darwin-x64`. On macOS it runs `codesign -s -`.
- `installKind()` answers `binary` when `isBinary`.

## Out of scope
The smoke test (task-003); releases (sprint-141); extension exclusion in the sync (task-002).

## Acceptance criteria
- [ ] On Linux x64: `pi-studio --version`, `pi-studio --json daemon start` / `status` / `stop`,
      `pi-studio __pi --version`, `pi-studio __skills --help`, `pi-studio ui` serving the SPA,
      `pi-studio relay start` / `stop` all work from the unpacked folder with no Node on `PATH`.
- [ ] Moving the unpacked folder elsewhere still works (assets found from `execPath`).
- [ ] `npm run build`, `typecheck`, `lint`, `test` stay green on Node.

## Test / verification plan
- `npm run build && npm run build:binary -- --target linux-x64`; the commands above in a container
  without Node; outputs in the summary.

## Notes
Record the archive and unpacked sizes.
