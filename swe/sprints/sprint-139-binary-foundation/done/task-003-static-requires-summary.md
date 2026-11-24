# Task 003 — No runtime `createRequire` — Summary

- **Sprint:** sprint-139-binary-foundation
- **Completed:** 2026-11-24
- **Status:** done

## What was built
- Version: each of server, cli and relay has a generated `src/version.generated.ts` (`PACKAGE_VERSION`) written from its `package.json` by an identical `scripts/gen-version.mjs` (no write when unchanged); the packages' `build` scripts and the root `build:*` scripts run it before `tsc -b`. `SERVER_VERSION`, the CLI `--version`/`CURRENT_VERSION` and relay's start log import it statically.
- xterm: `screen-buffer.ts` imports the `*.mjs` builds of `@xterm/headless` and `@xterm/addon-serialize` by deep path (no `exports` map; Node ESM and Bun resolve both); `terminal/xterm-esm.d.ts` re-exports their typings.
- **Deviation:** the generated files are **committed**, not gitignored: client, workbench, web-client and the desktop app reference the relay project, so a gitignored file breaks their clean-checkout builds and the Docker stages. Drift fails a test (`version.test.ts`, new `version.generated.test.ts` in cli and relay); the release flow's build rewrites the file after a version bump.

## Results
`grep -rn createRequire packages/*/src` (non-test): none. `node packages/cli/dist/cli.js --version` and `SERVER_VERSION`: 0.0.130. `bun build` (target bun) of cli `index.js`/`cli.js` and relay `relay-main.js`: no createRequire error; the bundled cli prints 0.0.130 and a bundled `ScreenBuffer` gives the same snapshot as Node. Full gate as in task 002.

## Acceptance
- [x] No runtime `createRequire` in src. [x] Versions unchanged. [x] Terminal tests pass. [x] Bundler follows the changed files.

## Follow-ups
A version bump without a rebuild fails the drift tests until `npm run build`.
