# Task 006 — Client SDK: `removeSkill`, `updateAllSkills`

- **Sprint:** sprint-076-skills-remove-update
- **Status:** done
- **Type:** feature
- **Area:** packages/client
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001

## Goal

Facade methods with the long timeouts the spec sets.

## Context / why

Default 30 s RPC timeout would fail real removes/updates.

## Scope references

- swe/features/skills-manager.md § Client SDK
- swe/architecture/pi-resource-management.md § Timeouts
- packages/client/src/pistudio-client.ts (sprint-075 skills methods; `COMPACT_TIMEOUT_MS` precedent)

## What to build

- `removeSkill({path} | {packageSource})` (660 s), `updateAllSkills()` (1 300 s); domain failures returned, not thrown.
- `packages/client/AGENTS.md`.

## Out of scope

- Install methods (sprint 077)

## Acceptance criteria

- [x] Requests carry the right payload and per-call timeout (fake transport)

## Test / verification plan

- `npx vitest run packages/client`
- `npm run build:client`
