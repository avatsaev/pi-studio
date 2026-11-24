# Task 003 — No `createRequire` in code the binary bundles

- **Sprint:** sprints/sprint-139-binary-foundation
- **Status:** done
- **Type:** refactor
- **Area:** packages/server, packages/cli, packages/relay
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001 (the gate)

## Goal
The five `createRequire` uses become static imports or build-time constants, with unchanged behaviour on Node.

## Context / why
A5. Bun's bundler does not follow `createRequire`; the spike patched these at build time.

## Scope references
- `swe/architecture/single-binary-daemon.md` § Decisions (A5)
- `packages/server/src/version.ts` (reads `../package.json`), `packages/server/src/terminal/screen-buffer.ts`
  (loads the xterm packages), `packages/cli/src/program.ts`, `packages/cli/src/update-control.ts`,
  `packages/relay/src/relay-main.ts`

## What to build
- Versions: a generated module (written by the package's build from its `package.json`) or a JSON
  import with `with { type: "json" }`; pick one convention for all three packages.
- xterm: static imports of the packages' ESM or CJS entry that both Node and Bun resolve.
- Keep `SERVER_VERSION` exactly the package version (the release bumps it).

## Out of scope
Spawn sites (task-002).

## Acceptance criteria
- [ ] `grep -rn createRequire packages/*/src` finds nothing outside tests.
- [ ] `pi-studio --version`, `server_info.version` and `/api/health` still report the package version
      after `npm run build`.
- [ ] Terminal tests (screen buffer, restore) pass.

## Test / verification plan
- `npm run build && npm run typecheck && npm run lint && npm test`
- `node packages/cli/dist/index.js --version`

## Notes
`scripts/publish.sh` bumps versions before the build; a generated module must be produced by the build, not committed.
