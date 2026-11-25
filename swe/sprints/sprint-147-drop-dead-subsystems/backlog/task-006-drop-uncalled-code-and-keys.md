# Task 006 — Drop four uncalled pieces of code and the dead config keys

- **Sprint:** sprints/sprint-147-drop-dead-subsystems
- **Status:** backlog
- **Type:** refactor
- **Area:** packages/server (agent, projects, config)
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-005

## Goal
Code and settings that nothing calls or reads are gone.

## Context / why
Owner decisions 2026-11-24. Depends on task-005 because both edit `pi/agent.ts` and `daemon-config.ts`.

## Scope references
- `docs/daemon-audit-handoff.md` § Decisions → Approved: delete four pieces of code, Approved drops:
  scope (Dead config keys)
- `packages/server/src/agent/providers/pi/agent.ts` (`history`, `streamHistory`,
  `PiClientDeps.appendSystemPrompt`), `provider-contract.ts` (`streamHistory`)
- `packages/server/src/agent/provider-snapshot.ts`, `agent/snapshot.test.ts`
- `packages/server/src/projects/reconciliation.ts` (+ test), `projects/workspace-activity.ts` (+ its
  tests in `open-project.test.ts`), their exports in `projects/index.ts`
- `packages/server/src/config/daemon-config.ts` (`log.*`, `worktrees.root`, `daemon.appendSystemPrompt`,
  `providers.local.modelsDir`)

## What to build
Delete them. The mock provider keeps its own private event list (it scripts answers from it); tests
that read `streamHistory` are reworked to read the timeline or the subscriber. The per-agent
`config.systemPrompt` is a different feature and stays. Docs: `packages/server/AGENTS.md`, fern
daemon-config page.

## Acceptance criteria
- [ ] No `streamHistory`, `ProviderSnapshotManager`, `reconcileRegistries`, `aggregateWorkspaceActivity`
      in `packages/server/src`.
- [ ] A `config.json` containing the removed keys still loads (they are ignored like any unknown key).

## Test / verification plan
- `npx vitest run packages/server/src`
- `npm run build:server`
