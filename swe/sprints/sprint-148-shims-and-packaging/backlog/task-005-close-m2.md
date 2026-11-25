# Task 005 — Close of M2: gates, docs sweep, handoff

- **Sprint:** sprints/sprint-148-shims-and-packaging
- **Status:** backlog
- **Type:** docs
- **Area:** cross-package
- **Priority:** P2
- **Estimated size:** S
- **Depends on:** task-001, task-002, task-003, task-004, sprint-147/task-002

## Goal
Everything dropped in sprints 147 and 148 is gone from the docs too, every gate is green, and the
handoff says M2 is done.

## Context / why
Each task updated its own docs; this is the sweep for what they missed across packages.

## Scope references
- `docs/daemon-audit-handoff.md` § Decisions, § 9
- Root `AGENTS.md`/`README.md`, every `packages/*/AGENTS.md`/`README.md`, `fern/`, `docker/README.md`

## What to build
- `rg` the repository (docs and code, outside `swe/sprints/` history and `docs/daemon-audit-handoff.md`)
  for every removed name: `serviceProxy`, `SERVICE_PROXY`, `daemon.cors`, `mcp-server`,
  `supportsMcpServers`, `modeId`, `extends: "pi"`, `registerAlias`, `chat_`, `loop_`, `schedule_`,
  `pi-studio ui`, `appendSystemPrompt` (daemon key), `log.file`, `worktrees.root`; fix what remains.
- Full gates: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run fmt:check`, `npm test`;
  `cd desktop && cargo xtask ci`.
- Mark M2 done in `docs/daemon-audit-handoff.md` and `swe/sprints/PLAN.md`; list in the summary the
  line count removed (`git diff --stat` against the sprint-147 start).

## Acceptance criteria
- [ ] The search finds only intended mentions (history, the handoff); all gates green.

## Test / verification plan
As above.
