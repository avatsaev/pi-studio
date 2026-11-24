# Task 005 — Documents and spec close for the daemon self-update — Summary

- **Sprint:** sprint-138-daemon-update-desktop
- **Completed:** 2026-11-23
- **Status:** done (orchestrator)

## What was implemented
- Updated: root `AGENTS.md` (the `daemon_update_*` bullet, env rows incl. `PI_STUDIO_DEV_UPDATE`, persistence lines), `README.md` (Updating the daemon), `packages/server/README.md`, `packages/cli/README.md`, `fern/pages/{configuration/daemon,configuration/docker,cli/daemon-and-auth}.mdx`, `docker/README.md`, `desktop/AGENTS.md`, `docs/desktop-client-handoff.md` (5b built and verified, with gaps). The five packages' `AGENTS.md` and `desktop/docs/*` were already true.
- Orchestrator: `swe/features/self-update.md` (status built and verified on Linux; criteria ticked with the evidence and its limits; 'Resolved by the build'; TODO(verify) rewritten), `swe/sprints/PLAN.md` close note.
- Greps for `npm i -g @av-pi-studio/cli`, `daemon restart`, `already running`, `pi-studio update`, `/api/health`: every remaining hit is true.

## Files changed
`AGENTS.md`, `README.md`, `packages/{server,cli}/README.md`, `fern/pages/**`, `docker/README.md`, `desktop/AGENTS.md`, `docs/desktop-client-handoff.md`, `swe/features/self-update.md`, `swe/sprints/PLAN.md`

## Build & test results
```
Gate: npm run build, typecheck ok; lint 0 errors; npm test -> 318 files / 4542 tests passed; cd desktop && cargo xtask ci -> all 8 steps passed (documents only since)
```

## Acceptance criteria
- [x] documents true against the code (greps and code reads); acceptance criteria ticked from evidence, limits named.

## Follow-ups
- `fern check` not run (the fern CLI is not installed here).
- Open for the owner: after a rollback the broken version is offered again at the next check.
