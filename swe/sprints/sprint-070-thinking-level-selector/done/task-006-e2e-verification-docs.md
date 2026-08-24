# Task 006 — Sprint close: live E2E verification matrix + docs sync

- **Sprint:** sprint-070-thinking-level-selector
- **Status:** done
- **Type:** docs
- **Area:** cross-package (verification + AGENTS.md/PLAN.md)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, task-005

## Goal

Prove the whole chain against a real daemon + real `pi` provider + browser, close the spec's
TODO(verify), and keep every scope doc truthful.

## Context / why

The persistence chain spans four packages and two restart boundaries; only a live pass proves it.
Sprint convention (069/t009, 043/t005): a consolidated sign-off matrix + docs as the closing task.

## Scope references

- `swe/features/thinking-level-selector.md` § Acceptance criteria, § TODO(verify)
- `AGENTS.md` (root — protocol overview, agent provider model), `packages/server/AGENTS.md`,
  `packages/client/AGENTS.md`, `packages/web-client/AGENTS.md`, `packages/protocol/AGENTS.md`,
  `packages/cli/AGENTS.md` (the `agent update --thinking` bug-fix note), `swe/sprints/PLAN.md`

## What to build

- **Live matrix (production daemon, real `pi`, browser):**
  1. pick level → visible in Pi (`get_state` via a probe or the selector's effective echo);
  2. reload browser → level shown;
  3. restart daemon → resume session → level survives (replayed after model);
  4. model switch to non-reasoning model → selector flips to `off` in a **second** window;
  5. draft pick → first send runs with the level;
  6. `pi-studio agent update --thinking <level>` against a live agent → actually applies (bug fix);
  7. TODO(verify): confirm whether `thinkingLevelMap` appears on any bundled model's
     `get_available_models` entry; record the observation in the spec.
- **Full gates:** `npm run build`, `npm run typecheck`, `npm test`, `npm run lint`,
  scoped `npx oxfmt` — all green (sprint-end gate per `av-swe.config.json`).
- **Docs:** root AGENTS.md (protocol overview gains the family; provider model section),
  per-package AGENTS.md files for every touched surface (server subsystem section, client facade
  table, web-client source layout + a "Thinking selector" invariant beside "Model selector",
  protocol schema list, cli bug-fix note), PLAN.md coverage line, spec TODO(verify) resolution.

## Out of scope

- Any new behavior. Findings that require code changes get filed as corrections
  (sprint-043 `corrections-post-sprint.md` precedent) or a follow-up task — not silently patched in.

## Acceptance criteria

- [ ] Every row of the live matrix passes, with the daemon restart and two-window steps actually
      performed (not simulated).
- [ ] All five root gates green.
- [ ] Every AGENTS.md whose package changed documents the new surface; no doc describes
      aspirational behavior.
- [ ] Spec's TODO(verify) replaced with the recorded observation.

## Test / verification plan

- The live matrix IS the test. Record each step's outcome in the task summary.
- `npm run build && npm run typecheck && npm test && npm run lint` — all pass.
