# Task 003 — Drop the unreachable MCP server — Summary

- **Sprint:** sprints/sprint-147-drop-dead-subsystems
- **Completed:** 2026-11-25
- **Status:** done

## What was implemented
Deleted `agent/mcp-server.ts` and its test; removed `supportsMcpServers` from the protocol capability schema, the Pi and mock providers; `mcpConfigPath` and `--mcp-config` from `buildPiArgs`; `AgentSessionConfig.mcpServers` from `messages.ts` and from the persisted record schema; the `daemon.mcp.*` config block; the index export; MCP mentions in docs and comments.

## Files created / changed
`packages/server/src/agent/{mcp-server.ts,mcp-server.test.ts}` (deleted), `agent/index.ts`, `agent/providers/pi/agent.ts`, `providers/mock/mock-provider.ts`, `config/daemon-config.ts` (+test), `persistence/entity-schemas.ts`, `packages/protocol/src/{provider-manifest,messages}.ts`, `packages/server/AGENTS.md`/`README.md`, `docs/gateway-architecture.md`, comments in four server files.

## Build & test results
```
$ npx vitest run packages/server/src/agent packages/server/src/config packages/protocol/src   -> 52 files, 923 passed
$ npm run build:protocol                                                                     -> success
$ Wave gate (full tree, once, after tasks 001 and 003): `npm run build` exit 0; `npm run typecheck` exit 0; `npm run lint` exit 0 (existing warnings only); `npm test` 326 files, 4682 tests, all passed; `oxfmt --check` on all changed source files clean.
```

## Acceptance criteria
- [x] No `mcp` reference left in `packages/server/src` or `packages/protocol/src` except one: the wire enum value `"mcp"` in `clientTypeSchema`.

## Follow-ups / TODO(verify)
- `clientTypeSchema` still lists `"mcp"` (with `"mobile"`). Nothing uses it now, but it is a published wire enum that the external fixtures' signature covers, so removing it needs the fixture and changelog procedure. Left for an owner decision; not part of this task's list.
