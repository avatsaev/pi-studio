# Summary — sprint-090 task-003 release-wiring (subagent PersonalPuma)

## What was built
`scripts/publish.sh`: `ui-library` added to `ALL_PACKAGES` and to `PUBLISH_ORDER` between `client` and `web-client` (order now protocol relay client ui-library web-client server cli). `docker/web-client.Dockerfile` copies `packages/ui-library` manifest + source. `packages/ui-library/CHANGELOG.md` (dated 2026-11-14 initial entry) and `RELEASING.md` (first-publish runbook: placeholder publish + Trusted Publisher before merge; rollback = revert + `npm deprecate`; not packed). `CHANGELOG.md` added to ui-library's `files` after `npm pack --dry-run` showed it was missing.

## Verification
- `bash -n scripts/publish.sh`; arrays confirmed by grep. Dep-rewrite and README-image logic confirmed by reading (loops over `ALL_PACKAGES`; images only when `src="assets/`).
- `docker build -f docker/web-client.Dockerfile` succeeded (~35 s); image removed.
- NOT run: `npm run publish -- --dry-run` (needs a clean tree) — repeat at release time.

## Acceptance criteria
- [x] AC9 (docker build; publish order by inspection). [ ] `publish --dry-run` pending a clean tree.
