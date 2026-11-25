# Task 005 — Close of M2: gates, docs sweep, handoff — Summary

- **Sprint:** sprints/sprint-148-shims-and-packaging
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
A repository-wide search for every removed name (`serviceProxy`, `SERVICE_PROXY`, `daemon.cors`, `mcp-server`, `supportsMcpServers`, `modeId`, `extends: "pi"`, `registerAlias`, `chat_`/`loop_`/`schedule_`, `pi-studio ui`, `appendSystemPrompt`, `log.file`, `worktrees.root`), then a doc and comment sweep: `CONTRIBUTING.md`; the web-client README and Vite comments; the workbench `random-id` comments and AGENTS; `lastModeId` dropped from the record schema; `swe/MAIN-SCOPE.md`, `swe/architecture/{config,auth-security,daemon-bootstrap,persistence,agent-lifecycle,single-binary-daemon,workbench-package}.md` and about fifteen `swe/features/` specs rewritten to what the code does now. Dated live-result records and the five retired specs are left as history. The handoff and `PLAN.md` mark M2 done.

## Build & test results
```
$ npm run build -> 0; npm run typecheck -> 0; npm run lint -> 0 (existing warnings only)
$ npm test -> first run 322/323 files, 1 failed test; three re-runs of the full suite: 4648/4648 passed each
$ cd desktop && cargo fmt --all --check && cargo xtask ci -> all 8 steps passed
$ npm run fmt:check -> 23 files flagged, none caused by this milestone's source changes: formatting of JSON, docs/compose and a few test files that were already flagged before it started (25 at the start of M1)
$ git diff --shortstat a6efaa9a -- . ':!swe' ':!docs'  -> 156 files changed, 1016 insertions(+), 6337 deletions(-)  (M1 and M2 together, outside swe/ and docs/)
```

## Acceptance criteria
- [x] The search finds only intended mentions (history, the handoff, retired specs, dated live results; `clientType: "mcp"` remains, see below)
- [ ] All gates green: all green except one intermittent test failure (first full run only; not identified, not reproduced in three re-runs; the extension-packs round trip in `bootstrap.test.ts` failed intermittently before M1 as well, and looks network-dependent), and `fmt:check` flags the 23 pre-existing files.

## Follow-ups / TODO(verify)
- Owner decisions still open: `"mcp"` and `"mobile"` in `clientTypeSchema` (a published wire enum covered by the external fixtures' signature); `agent_permission_*` schemas still in the protocol.
- Owner action: `npm deprecate` the old `@av-pi-studio/{workbench,ui-library,web-client}` versions.
- The relay parking of 0.0.120 daemons stays deferred.
