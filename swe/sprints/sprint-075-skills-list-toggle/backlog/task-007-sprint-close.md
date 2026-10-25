# Task 007 — Sprint close: live E2E against a real daemon, root docs, full gates

- **Sprint:** sprint-075-skills-list-toggle
- **Status:** backlog
- **Type:** docs
- **Area:** repo-wide
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005, task-006

## Goal

Prove list + toggle end to end against a production daemon and real Pi, then land root docs.

## Context / why

Tasks used fixtures; the contract that matters is agreement with a real `pi` on the same host.

## Scope references

- swe/features/skills-manager.md § Acceptance criteria (listing, toggle, shadowing, host-side refresh)
- Root AGENTS.md § Protocol overview, § Pi dependency posture (bump checklist)
- swe/sprints/PLAN.md sprint-075 section

## What to build

Live E2E (`npm run build && npm start` with a throwaway `--pi-home` **and** `HOME` where possible; two browser windows). Record each result, or not-run with the reason:
1. Panel lists every skill grouped by origin; dev daemon shows no category.
2. Disable a skill → `settings.json` gains the same entry `pi config` writes; a new agent's slash picker lacks `/skill:<name>`; `pi config` shows it unchecked; re-enable reverses both.
3. Duplicate name in both skill dirs → loser "shadowed by …".
4. Edit settings.json / run `npx skills add` on the host → both windows update.
5. Toggle a curated package skill → confirm shown → package row `filtered`.

Docs: root `AGENTS.md` protocol bullet for `skills_*` (list/set_enabled/skills_changed, prod-only, no subscribe RPC), Pi-bump checklist adds `resources/toggle-patterns.ts` and the `SettingsManager`/`DefaultPackageManager`/`loadSkillsFromDir` imports in `resources/pi-sdk.ts`; PLAN.md status.

## Out of scope

- Remove/update/install

## Acceptance criteria

- [ ] Every E2E step recorded with observed result
- [ ] Root docs updated
- [ ] `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` green

## Test / verification plan

- The live steps above
- Full gates
