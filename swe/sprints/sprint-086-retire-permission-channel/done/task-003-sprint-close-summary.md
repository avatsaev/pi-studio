# Task 003 — Sprint close: docs, specs, gates — Summary

- **Sprint:** sprints/sprint-086-retire-permission-channel
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
Docs sweep: root/server/cli/protocol AGENTS.md + READMEs, fern CLI pages (`permit` removed; dotted-name examples now use `checkout.github.set_auto_merge.request`), protocol AGENTS rows marked retired. `swe/features/tool-permissions.md` marked retired with evidence; `mcp-server.md`/`cli.md` drop permission tools/commands; MAIN-SCOPE § 10 item resolved and index row set to retired.

## Files changed
AGENTS.md; packages/{cli,protocol,server}/{AGENTS,README}.md (cli README/AGENTS, protocol README/AGENTS, server README/AGENTS); fern/pages/cli/{feature-groups,overview}.mdx; swe/features/{tool-permissions,mcp-server,cli}.md; swe/MAIN-SCOPE.md.

## Build & test results
```
$ npm run build        # success
$ npm run typecheck    # success
$ npm run lint         # success
$ npm run fmt:check    # FAILS: 43 files, all pre-existing (identical with my changes stashed; none touched by this sprint)
$ npm test             # 241 files, 3284 passed, 0 failed
```
grep for permit/permission across root/package docs and fern shows only retired-family notes or unrelated uses (file permissions, PTY sizing permission in web-client).

## Acceptance criteria
- [x] grep clean apart from retired notes/unrelated uses
- [~] gates green except pre-existing `fmt:check` failures in unrelated files

## Follow-ups / TODO(verify)
- Pre-existing `fmt:check` failures (43 files) are outside this sprint.
