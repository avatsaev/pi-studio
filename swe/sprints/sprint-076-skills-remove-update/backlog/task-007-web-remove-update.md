# Task 007 — Web: Remove, Remove package, Update all

- **Sprint:** sprint-076-skills-remove-update
- **Status:** backlog
- **Type:** feature
- **Area:** packages/web-client (features/skills)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-006

## Goal

Row Remove with origin-specific confirms, package-header Remove package, toolbar Update all with results.

## Context / why

Completes the second user-visible slice.

## Scope references

- swe/features/skills-manager.md § Remove, § Update all, § Data flow
- packages/web-client/src/features/skills/ (sprint-075 panel)

## What to build

- Row Remove only when `removable`; confirm text by origin (symlink / Agent Skills with provenance / plain dir / skill path) from `skills-presentation.ts`.
- Package header Remove package; confirm shows its skill count.
- Toolbar Update all with confirm, busy state, two result rows (collapsible stderr).
- Responses replace query data (no optimistic remove); "Queued…" when another mutation is running.

## Out of scope

- Install dialog (sprint 077)

## Acceptance criteria

- [ ] Packaged rows show no Remove
- [ ] Each origin shows its confirm text
- [ ] Update all shows per-engine results and the list refreshes

## Test / verification plan

- Extend `skills-presentation` tests (confirm text per origin)
- `npx vitest run packages/web-client/src/features/skills`; `npm run build:web-client`
