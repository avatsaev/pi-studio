# Task 004 — Install `npm:`/`git:` Pi packages, skills-only

- **Sprint:** sprint-077-skills-install
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (resources)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002

## Goal

Install a Pi package so its skills load and its extensions, prompts and themes do not.

## Context / why

R3/R8: package installed as a unit via spawned (killable) `pi install`, then one locked write of the filtered entry.

## Scope references

- swe/architecture/pi-resource-management.md § Install (pi_npm | pi_git), § Error handling
- packages/server/src/resources/toggle-patterns.ts (entry upgrade helpers)
- task-001 summary (filter preservation answer)

## What to build

- Queued. Spawn bundled `pi install <source>` (600 s). Non-zero ⇒ `install_failed` + stderr, still re-list.
- Else reload settings, find the same-identity entry, upgrade to object form with `extensions: [], prompts: [], themes: []` (keep any existing `skills` filter), `setPackages` + `flush`.
- Filter write failure ⇒ failed ItemResult; package row will show `filtered: false` (no rollback).
- One ItemResult targeting the source.

## Out of scope

- Picking skills out of a package (R3, never)

## Acceptance criteria

- [ ] With a fake spawn that writes a bare entry like Pi does, the final settings.json holds the object form with the three empty arrays
- [ ] A pre-existing `skills` filter on the entry survives
- [ ] Spawn timeout ⇒ `timeout`, queue proceeds

## Test / verification plan

- `npx vitest run packages/server/src/resources`
- `npm run build:server`
