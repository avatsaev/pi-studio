# Task 006 — Client SDK: `previewSkillSource`, `installSkills`

- **Sprint:** sprint-077-skills-install
- **Status:** done
- **Type:** feature
- **Area:** packages/client
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002

## Goal

Facade methods for the install dialog.

## Context / why

Long-running calls need explicit timeouts.

## Scope references

- swe/features/skills-manager.md § Client SDK
- swe/architecture/pi-resource-management.md § Timeouts

## What to build

- `previewSkillSource(source)` (150 s), `installSkills({source, skills?, replace?})` (660 s).
- Re-export `detectSkillSource` for the web client.
- `packages/client/AGENTS.md`.

## Out of scope

- UI

## Acceptance criteria

- [x] Requests carry the right payload and timeout (fake transport)

## Test / verification plan

- `npx vitest run packages/client`
- `npm run build:client`
