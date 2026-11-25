# Task 004 — Stop publishing `workbench`, `ui-library` and `web-client` — Summary

- **Sprint:** sprints/sprint-148-shims-and-packaging
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
The three packages are `"private": true` and their `@av-pi-studio/*` dependencies are `"*"`. `scripts/publish.sh` publishes `protocol relay client server cli` (five); the three private packages stay in `ALL_PACKAGES` so they keep the shared version (`web-client` shows it in the UI), and the bump rewrites `^<version>` ranges only for the published five. Deleted `packages/workbench/RELEASING.md` and `scripts/pack-smoke.sh`, `packages/ui-library/RELEASING.md` and `scripts/pack-smoke.sh`; kept `check-dist.mjs` (`build:workbench` uses it) and the workbench `exports`/build (the `vite/` entry is imported by relative path; `ui-gallery` consumes the ui-library `dist`). The rehearsal and `ETARGET` rule moved from `workbench/RELEASING.md` into root `AGENTS.md`, with the "8 packages" and trusted-publisher text updated. `package-lock.json` changed only in the five `"*"` entries.

## Build & test results
```
$ npm run build:ui-library && build:workbench && build:web-client && npm run typecheck   -> pass
$ cd desktop/apps/pistudiodesktop && npx tsc --noEmit                                     -> clean
$ rehearsal: detached worktree /tmp/pub-rehearsal (HEAD + this diff committed temporarily), npm ci, npm run publish -- --dry-run
   -> exit 0: version 0.0.133, 323 files / 4648 tests passed, five packages dry-run published in order, ranges ^0.0.133, no dependency on a private package (worktree removed)
```
The rehearsal needed the gitignored `.npmrc` copied into the worktree for the script's auth check; `--dry-run` published nothing.

## Acceptance criteria
- [x] `npm run publish -- --dry-run` in a throwaway worktree publishes five packages and passes
- [x] `build:web-client` and the desktop TypeScript still pass (`tsc --noEmit`; the desktop gate runs in task-005, not `npm run build` there)

## Follow-ups / TODO(verify)
- **Owner action:** `npm deprecate` the versions of `@av-pi-studio/{workbench,ui-library,web-client}` already on npm. Not run.
- `docs/desktop-client-handoff.md` is a historical record and still mentions the deleted files.
