# Task 008 — Sprint close: live E2E, docs, full gates

- **Sprint:** sprint-076-skills-remove-update
- **Status:** backlog
- **Type:** docs
- **Area:** repo-wide
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005, task-006, task-007

## Goal

Prove remove and update-all against a real daemon, real `pi` and the real `skills` CLI.

## Context / why

Spawned CLIs are faked in unit tests.

## Scope references

- swe/features/skills-manager.md § Acceptance criteria (remove, update all, FIFO, redaction)
- Root AGENTS.md § Tech stack, § Protocol overview
- swe/sprints/PLAN.md sprint-076 section

## What to build

Live E2E in a throwaway `HOME` + `--pi-home` (two windows):
1. Remove a symlinked skill → target kept.
2. `npx skills add` a skill, then Remove it in the UI → lock entry gone.
3. Remove a settings-path skill → files kept.
4. Remove package → entry gone from settings.json.
5. Update all with an outdated skill and an outdated unpinned package → both current; a pinned package untouched.
6. Start Update all, then Remove from the other window → second shows Queued and runs after.
7. A `git:https://user:tok@…` source in a log line is redacted.

Docs: root `AGENTS.md` Node floor + tech-stack row for `skills` CLI + protocol bullet; package docs; PLAN.md status.

## Out of scope

- Install

## Acceptance criteria

- [ ] Every step recorded with observed results
- [ ] Full gates green

## Test / verification plan

- Live steps above
- `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`
