# Task 004 — Drop agent modes (`plan` / `default` / `full-access`)

- **Sprint:** sprints/sprint-147-drop-dead-subsystems
- **Status:** done
- **Type:** refactor
- **Area:** packages/server (agent), packages/protocol, packages/client, packages/cli
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-003

## Goal
No code pretends that agents have modes.

## Context / why
Owner decision 2026-11-24. Pi has no mode command; `PiAgentSession.setMode` only sets a local field,
so the advertised modes, including "full-access", change nothing. The workbench has no mode UI
(checked). Depends on task-003 (both edit `pi/agent.ts` and `provider-manifest.ts`).

## Scope references
- `docs/daemon-audit-handoff.md` § Decisions → Approved drops: scope (Mode support), § A11
- `packages/server/src/agent/provider-contract.ts` (`getAvailableModes`, `getCurrentMode`, `setMode`,
  `listModes`, `modeId` in the run config)
- `packages/server/src/agent/providers/pi/agent.ts`, `providers/mock/mock-provider.ts`
- `packages/server/src/agent/manifest.ts`, `provider-registry.ts` (`modes`)
- `packages/server/src/agent/session-operations.ts` (`modeId` in `update_agent`)
- `packages/server/src/persistence/entity-schemas.ts` (`modeId` in the agent record)
- `packages/protocol/src/provider-manifest.ts` (`modes`, `providerModeSchema`)
- `packages/client/src/pistudio-client.ts` (`modeId` in create/update options)
- `packages/cli/src/agent-commands.ts` (any `mode` command or `--mode` flag)

## What to build
Delete them and their tests. The agent record schema stays `.passthrough()` (owner decision: keep), so
an existing record's `modeId` is kept on disk and ignored. Re-check `packages/protocol/fixtures/` for
`modes`/`modeId` before deleting (none on 2026-11-24). Docs: protocol, server, client, CLI `AGENTS.md`.

## Acceptance criteria
- [ ] No `modeId`, `setMode`, `listModes`, `getAvailableModes` or `getCurrentMode` in `packages/*/src`.
- [ ] `list_providers_response` carries no `modes`.

## Test / verification plan
- `npx vitest run packages/server/src/agent packages/protocol/src packages/client/src packages/cli/src`
- `npm run build:protocol && npm run build:client && npm run build:server && npm run build:cli`
