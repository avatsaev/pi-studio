# Task 003 — The CLI package and the single binary stop carrying the web app

- **Sprint:** sprints/sprint-148-shims-and-packaging
- **Status:** backlog
- **Type:** chore
- **Area:** packages/cli, scripts (binary build)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** sprint-146/task-004

## Goal
About 27 MB of web app leave the CLI's npm package and the `pi-studio` binary.

## Context / why
With `pi-studio ui` gone (sprint-146/task-004) nothing in the CLI or the binary serves the SPA. Owner
decision 2026-11-24 (Lite, row 1).

## Scope references
- `docs/daemon-audit-handoff.md` § Web client as "Lite" (row 1), § Milestones (M2)
- `packages/cli/package.json` (`@av-pi-studio/web-client` dependency)
- `scripts/build-binary.mjs` (the `web/` layout comment and the `dist/web` copy near line 174),
  `scripts/build-binary.test.mjs`, `scripts/binary-smoke.mjs`
- Root `AGENTS.md` dependency graph (`cli ──► … web-client`) and the paragraph explaining why `cli`
  depends on `web-client`

## What to build
Remove the dependency, the copy and anything in the binary layout or smoke test that expects
`web/`. Update the lockfile (`npm install`), the dependency graph and `packages/cli/AGENTS.md`.

## Acceptance criteria
- [ ] `npm pack --dry-run -w @av-pi-studio/cli` lists no SPA files.
- [ ] `npm run build:binary` then `npm run test:binary` pass on Linux, and the binary has no `web/`.

## Test / verification plan
- `npx vitest run packages/cli/src` and `node --test scripts/build-binary.test.mjs` (or the repo's
  runner for it)
- `npm run build:binary && npm run test:binary`
