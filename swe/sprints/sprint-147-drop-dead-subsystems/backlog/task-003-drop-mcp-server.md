# Task 003 — Drop the unreachable MCP server

- **Sprint:** sprints/sprint-147-drop-dead-subsystems
- **Status:** backlog
- **Type:** refactor
- **Area:** packages/server (agent, config), packages/protocol (provider manifest)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** sprint-146/task-006

## Goal
`mcp-server.ts` and everything that exists only for it are gone.

## Context / why
Owner decision 2026-11-24. The file's own header says it is not reachable at runtime: no route, no
backend, and no Pi spawn passes `--mcp-config`.

## Scope references
- `docs/daemon-audit-handoff.md` § Decisions → Approved drops: scope (`agent/mcp-server.ts`)
- `packages/server/src/agent/mcp-server.ts`, its test, its export in `packages/server/src/agent/index.ts`
- `packages/server/src/agent/providers/pi/agent.ts` (`buildPiArgs`'s `mcpConfigPath`, `supportsMcpServers`)
- `packages/server/src/agent/providers/mock/mock-provider.ts` (`supportsMcpServers`)
- `packages/protocol/src/provider-manifest.ts:24` (`supportsMcpServers`)
- `packages/server/src/config/daemon-config.ts` (`daemon.mcp.*`)

## What to build
Delete them. `supportsMcpServers` is removed from the protocol's capability schema: no external-client
fixture carries it (checked 2026-11-24); re-check `packages/protocol/fixtures/` before deleting and
follow the fixture procedure if one does. Docs: `packages/protocol/AGENTS.md`, `packages/server/AGENTS.md`.

## Acceptance criteria
- [ ] No `mcp` reference left in `packages/server/src` or `packages/protocol/src` except unrelated words.

## Test / verification plan
- `npx vitest run packages/server/src/agent packages/protocol/src`
- `npm run build:protocol && npm run build:server`
