# Task 004 — Stop publishing `workbench`, `ui-library` and `web-client` to npm

- **Sprint:** sprints/sprint-148-shims-and-packaging
- **Status:** in_progress
- **Type:** chore
- **Area:** release tooling, packages/workbench, packages/ui-library, packages/web-client
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-003

## Goal
A release publishes five npm packages (protocol, relay, client, server, cli) instead of eight.

## Context / why
These three were published only so the CLI could ship the web app; the desktop app and the web
client build them from source through Vite aliases. Owner decision 2026-11-24 (Lite, row 1).

## Scope references
- `docs/daemon-audit-handoff.md` § Web client as "Lite" (row 1), § Milestones (M2)
- `scripts/publish.sh` (`PUBLISH_ORDER` at line 28; the internal-dependency rewrite; the README image
  rewrite)
- `packages/workbench/package.json`, `packages/ui-library/package.json`, `packages/web-client/package.json`
- `packages/workbench/RELEASING.md`, `packages/workbench/scripts/pack-smoke.sh`, `check-dist.mjs`,
  `packages/ui-library/RELEASING.md`
- `.github/workflows/release.yml`; root `AGENTS.md` § Release & production deployment (the "8 packages"
  text and the trusted-publisher note)

## What to build
- The three packages become `"private": true`; workspace dependencies between private packages use
  `"*"` (root `AGENTS.md` rule); `PUBLISH_ORDER` loses them.
- `pack-smoke.sh` and the RELEASING files: delete them, or keep `check-dist.mjs` if the build still
  uses it; nothing else should reference publishing these packages.
- The web-client Docker image and the desktop build are unaffected (both build from source).
- Docs in the same change.

## Out of scope
Deprecating the versions already on npm: an owner action (`npm deprecate`), noted in the summary.

## Acceptance criteria
- [ ] `npm run publish -- --dry-run` in a throwaway worktree (root `AGENTS.md` rehearsal rule) publishes
      five packages and passes.
- [ ] `npm run build:web-client` and `cd desktop/apps/pistudiodesktop && npm run build` (or the desktop
      gate) still pass.

## Test / verification plan
- As above, in a throwaway `git worktree`.
