# Task 002 — Remove the MCP permission tools and the CLI `permit` group

- **Sprint:** sprint-086-retire-permission-channel
- **Status:** done
- **Type:** refactor
- **Area:** packages/server (agent/mcp-server); packages/cli (feature-commands)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-001

## Goal

No user-facing command or tool lists or answers permissions that can never exist.

## Context / why

The MCP server exposes `list_pending_permissions` / `respond_to_permission` (`mcp-server.ts:278-296`,
backend members :85-88). The CLI ships `pi-studio permit ls` / `permit allow`
(`feature-commands.ts:49-51`, :278+). `permit ls` targets `list_permissions_request`, which was
never registered.

## Scope references

- packages/server/src/agent/mcp-server.ts (+ `mcp-server.test.ts`); keep the comment at :90-:96
  coherent, since it currently explains the extension-UI tool by analogy with permissions
- packages/cli/src/feature-commands.ts (+ `feature-commands.test.ts`)
- swe/features/mcp-server.md, swe/features/cli.md (command tree)

## What to build

- Remove both MCP tools and the `listPendingPermissions` / `respondToPermission` backend members.
- Remove the `permit` command group and its RPC-name constants.

## Acceptance criteria

- [ ] `pi-studio --help` no longer lists `permit`. The MCP tool list has no permission tools (the
  test asserts the exact tool set).
- [ ] `grep -rn "permit\b\|list_pending_permissions\|respond_to_permission" packages/{server,cli}/src`
  finds nothing outside the retired-schema comment.

## Test / verification plan

- `npx vitest run packages/server/src/agent/mcp-server.test.ts packages/cli`;
  `npm run build:server && npm run build:cli`; run `node packages/cli/dist/index.js --help`
  (or the package's bin) to confirm
