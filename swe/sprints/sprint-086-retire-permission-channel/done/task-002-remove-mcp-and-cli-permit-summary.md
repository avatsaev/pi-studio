# Task 002 — Remove the MCP permission tools and the CLI `permit` group — Summary

- **Sprint:** sprints/sprint-086-retire-permission-channel
- **Completed:** 2026-11-13
- **Status:** done

## What was implemented
Removed MCP tools `list_pending_permissions`/`respond_to_permission` and the `McpBackend` members; fixed the dependent comments. Removed the CLI `permit` group and `permitRespond`/`permitList` constants. Docs/specs handled in task-003.

## Files changed
| File | Change |
|------|--------|
| `packages/server/src/agent/mcp-server.ts` | tools, backend members, comments removed |
| `packages/server/src/agent/mcp-server.test.ts` | permission test/stubs removed; asserts tools absent |
| `packages/cli/src/feature-commands.ts` | `permit` group + RPC constants removed |
| `packages/cli/src/feature-commands.test.ts` | permit test removed |

## Build & test results
```
$ npx tsc -b --force                       # success
$ npx vitest run packages/server/src/agent/mcp-server.test.ts packages/cli   # 27 files, 453 passed
$ npm run build:server && npm run build:cli   # success
$ node packages/cli/dist/index.js --help | grep -ci permit   # 0
$ npx oxfmt / oxlint on changed files        # clean
```

## Acceptance criteria
- [x] `--help` no longer lists `permit`; MCP test asserts the tools are absent
- [x] grep in packages/{server,cli}/src finds only the retired-family test assertions

## Follow-ups / TODO(verify)
- none
