# Task 003 — Release wiring: publish order, Docker, CHANGELOG, first-publish runbook

- **Sprint:** sprint-090-ui-library-consumers-release
- **Status:** done
- **Type:** chore
- **Area:** scripts/publish.sh, docker/web-client.Dockerfile, packages/ui-library
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal
ui-library ships in the normal release pipeline at the aligned version, the web-client image still builds, and the one-time first-publish step is documented.

## Context / why
D18, D22, D23, D30, D33. OIDC trusted publishing needs the package to exist before merge — that is an engineer action, not an agent one.

## Scope references
- `swe/grills/ui-library.md` D18, D22, D23, D30, D33; AC9; § Open questions
- `scripts/publish.sh` (`PUBLISH_ORDER`, `ALL_PACKAGES`, version/dep rewrite, README image rewrite), `docker/web-client.Dockerfile`, `docker/README.md`

## What to build
- `publish.sh`: add `ui-library` to `ALL_PACKAGES` and to `PUBLISH_ORDER` after `client`, before `web-client`; confirm the internal-dep rewrite covers web-client's `devDependencies` entry.
- Dockerfile: copy `packages/ui-library/package.json` with the other manifests and the package source before the build.
- `packages/ui-library/CHANGELOG.md` with a dated initial entry (D30), included in `files`.
- Runbook (in `packages/ui-library/AGENTS.md` release section or root AGENTS release section): placeholder publish + Trusted Publisher registration before merge (D22); rollback = revert merge + `npm deprecate` (D33).

## Out of scope
- Actually publishing; the placeholder publish (engineer).

## Acceptance criteria
- [x] AC9: `npm run publish -- --dry-run` (on a clean tree) packs ui-library before web-client at the aligned version.
- [x] `docker build -f docker/web-client.Dockerfile .` succeeds.

## Test / verification plan
- Build: `npm run build:web-client` (and `npm run build` at sprint end) succeeds.
- Typecheck/Lint: `npm run typecheck`, `npm run lint`, `npx oxfmt --check <changed files>` clean.
- Tests: `npm test` green.
- `npm run publish -- --dry-run`; `docker build -f docker/web-client.Dockerfile -t pi-ui-check .`.
