# Task 001 — Release wiring and a dry-run publish — Summary

- **Sprint:** sprints/sprint-095-workbench-release
- **Completed:** 2026-11-14
- **Status:** done

## What was implemented
`scripts/publish.sh`: `PUBLISH_ORDER` now includes `workbench` between `ui-library` and `web-client`; `ALL_PACKAGES` includes it; header comment updated. `packages/workbench/RELEASING.md` (first-publish steps with Trusted Publisher, the throwaway-worktree rehearsal rule, rollback). The Dockerfile change was done in sprint 092 task-004 and re-verified here. Rehearsed `npm run publish -- --dry-run` in a throwaway git worktree on a temporary branch cut from the committed wiring.

## Files created / changed
| File | Change |
|------|--------|
| `scripts/publish.sh` | workbench in PUBLISH_ORDER and ALL_PACKAGES; comment |
| `packages/workbench/RELEASING.md` | created |

## How it satisfies the scope
`workbench-package.md` § Release wiring. The rehearsal is exactly the step missing before the 0.0.117 failure.

## Build & test results
```
Worktree dry run (GITHUB_ACTIONS=true to skip the interactive npm-auth check; no publish happens in --dry-run):
==> Bumping patch version for all packages -> 0.0.118 (workbench manifest, web-client devDependency ^0.0.118)
==> Syncing lockfile -> OK (ui-gallery's ui-library dependency stays "*")
==> Clean build -> check-dist: ok
==> Typecheck -> OK
==> Test suite -> 267 files / 3582 tests passed
==> Publishing (dry-run), order: protocol relay client ui-library workbench web-client server cli -> all 8 listed in order, exit 0

docker build -f docker/web-client.Dockerfile -t pi-studio-web-client:test .  -> exit 0
docker run -p 8089:8080 ...: GET / -> 200 (title "Pi-Studio"), hashed entry JS -> 200, /pdfjs/wasm/openjpeg.wasm -> 200
Cleanup: worktree removed, branch rehearse/workbench-publish deleted, image/container removed; feature branch version still 0.0.117.
```

## Acceptance criteria
- [x] Dry run completes for all eight packages in the stated order.
- [x] Lockfile sync succeeds with no registry lookup failure.
- [x] Docker image builds and serves the application (including pdf.js data).
- [x] Throwaway worktree and branch removed; no bumped versions on `feat/workbench`.
- [x] `docs/desktop-client-handoff.md`: nothing it states changed (the release row is updated in task-002/003).

## Follow-ups / TODO(verify)
- The rehearsal skipped the interactive `npm whoami` check by setting GITHUB_ACTIONS=true; `publish.sh` runs no registry writes in --dry-run.
