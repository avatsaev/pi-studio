# Task 004 — Remove `pi-studio ui` — Summary

- **Sprint:** sprints/sprint-146-close-the-door
- **Completed:** 2026-11-24
- **Status:** done

## What was implemented
Deleted `ui-commands.ts`, `web-server.ts` and their tests; removed `registerUiCommands` from `program.ts`; every `pi-studio ui` mention in the READMEs, AGENTS files and fern pages now says the CLI does not serve the web app (use the desktop app or the hosted client).

## Files created / changed
| File | Change |
|------|--------|
| `packages/cli/src/ui-commands.ts`, `ui-commands.test.ts`, `web-server.ts`, `web-server.test.ts` | deleted |
| `packages/cli/src/program.ts` | import and call removed |
| root and cli `README.md`/`AGENTS.md`; fern `quickstart`, `welcome`, `web-ui`, `cli/overview` | updated |

## Build & test results
```
$ npx vitest run packages/cli/src   -> 19 files, 294 passed
$ npm run build:cli                 -> success
$ Wave gate (full tree, once, after tasks 001-005): `npm run build` exit 0; `npm run typecheck` exit 0; `npm run lint` exit 0 (existing warnings only); `npm test`: 329 of 330 files pass, 4727 of 4728 tests pass. The one failure, `packages/server/src/daemon/bootstrap.test.ts` > "extension packs RPC ... full round trip", fails identically on a pristine checkout of HEAD `a6efaa9a` (checked in a temporary worktree), so it is not caused by this sprint. `npm run fmt:check` reports 25 files; the 8 docs/compose files this sprint touched were already unformatted at HEAD.
```

## Acceptance criteria
- [x] `pi-studio ui` is gone and nothing under `packages/cli/src` references `web-server` (grep and green build)

## Follow-ups / TODO(verify)
- `packages/cli/package.json` still depends on web-client and `scripts/build-binary.mjs` still copies the web app: sprint-148/task-003.
