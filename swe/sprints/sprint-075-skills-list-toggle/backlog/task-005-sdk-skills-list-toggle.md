# Task 005 — Client SDK: `listSkills`, `setSkillEnabled`, `onSkillsChanged`, `hasSkillsCapability`

- **Sprint:** sprint-075-skills-list-toggle
- **Status:** backlog
- **Type:** feature
- **Area:** packages/client
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal

The four facade members the panel needs.

## Context / why

All network traffic goes through `PiStudioClient`.

## Scope references

- swe/features/skills-manager.md § Client SDK
- packages/client/src/pistudio-client.ts:836-870 (viewer-settings methods are the pattern)
- packages/client/AGENTS.md

## What to build

- `hasSkillsCapability()` → `daemon.hasFeature("skills")`.
- `listSkills()`, `setSkillEnabled(path, enabled)` → typed responses (domain `{ok:false}` returned, not thrown).
- `onSkillsChanged(cb)` → unsubscribe; filters the `skills_changed` push.
- `packages/client/AGENTS.md` facade list.

## Out of scope

- Mutating methods of sprints 076–077

## Acceptance criteria

- [ ] Against a fake transport each method sends the right request type and resolves the typed response
- [ ] `onSkillsChanged` fires on the push and stops after unsubscribe

## Test / verification plan

- Extend the facade tests in `packages/client/src`
- `npx vitest run packages/client` and `npm run build:client`
