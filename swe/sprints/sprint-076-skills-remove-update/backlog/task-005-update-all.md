# Task 005 — `skills_update_all`: `skills update -g -y` + `pi update --extensions`

- **Sprint:** sprint-076-skills-remove-update
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (resources)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-003

## Goal

One queued operation that updates every Agent Skills skill and every unpinned Pi package.

## Context / why

Replaces the per-skill check (R5): both commands are idempotent and own their own update logic.

## Scope references

- swe/architecture/pi-resource-management.md § Update all

## What to build

- Two spawns in sequence, 600 s each; one `ItemResult` per engine (`agent-skills`, `pi-packages`); one failing does not skip the other; `ok` is true only when both succeed. Re-list and broadcast once at the end.

## Out of scope

- Per-row updates (deferred)

## Acceptance criteria

- [ ] Both commands spawned with the spec's argv/env (fake spawn)
- [ ] A failure in the first still runs the second; results report each independently

## Test / verification plan

- `npx vitest run packages/server/src/resources`
- `npm run build:server`
