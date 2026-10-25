# Task 001 — Protocol: `skills_remove` and `skills_update_all`

- **Sprint:** sprint-076-skills-remove-update
- **Status:** done
- **Type:** feature
- **Area:** packages/protocol
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Wire schemas for removing a skill or a whole package and for updating everything.

## Context / why

Extends the sprint-075 family; append-only.

## Scope references

- swe/architecture/pi-resource-management.md § Wire family (remove, update_all rows; ItemResult; timeouts)
- packages/protocol/src/messages.ts (sprint-075 `skills_*` schemas)
- packages/protocol/src/session-messages.test.ts

## What to build

- `skillsRemoveRequestSchema`: exactly one of `path` | `packageSource` (refine); response `{ok, error?, stderr?, skills, packages}`.
- `skillsUpdateAllRequestSchema` (empty) / response `{ok, error?, results: ItemResult[], skills, packages}`.
- `itemResultSchema` `{target, ok, error?, stderr?}`.
- Union registration, exported types, `packages/protocol/AGENTS.md`.

## Out of scope

- Install/preview schemas (sprint 077)

## Acceptance criteria

- [x] Remove with both or neither of `path`/`packageSource` is rejected
- [x] Update-all response with mixed ok/failed results parses

## Test / verification plan

- `npx vitest run packages/protocol`
- `npm run build:protocol`
