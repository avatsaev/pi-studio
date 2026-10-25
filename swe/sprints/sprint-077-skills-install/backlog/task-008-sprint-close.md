# Task 008 — Sprint close: live E2E over direct and relay, docs, full gates

- **Sprint:** sprint-077-skills-install
- **Status:** backlog
- **Type:** docs
- **Area:** repo-wide
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005, task-006, task-007

## Goal

Prove every install path end to end and close the feature.

## Context / why

Install is the riskiest path (network, npm scripts, CLI behaviour).

## Scope references

- swe/features/skills-manager.md § Acceptance criteria (all)
- Root AGENTS.md § Protocol overview
- swe/MAIN-SCOPE.md, swe/sprints/PLAN.md

## What to build

Live E2E in a throwaway `HOME` + `--pi-home`, one window direct and one over the relay:
1. `vercel-labs/agent-skills` → preview → pick two → only those two in `~/.agents/skills`, lock records them, both windows update.
2. `npm:` package with skills + an extension → new agent lists its skills, extension not loaded; row `filtered`.
3. `git:` package → same.
4. Host path → `settings.skills` entry, nothing copied; Remove keeps files.
5. Two installs from both windows → FIFO, both complete.
6. Nonexistent package → fails within the timeout with bounded stderr; list matches disk.
7. Private repo without credentials → fails fast, no hang.

Docs: root `AGENTS.md` protocol bullet complete for the family; feature spec status; MAIN-SCOPE open question closed; PLAN.md.

## Out of scope

- none

## Acceptance criteria

- [ ] Every step recorded with observed results
- [ ] All feature acceptance criteria satisfied or explicitly not-run with reason
- [ ] Full gates green

## Test / verification plan

- Live steps above
- `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`
