# Task 003 — Per-project pi-studio.json config + revision model

- **Sprint:** sprint-003-persistence-config
- **Status:** done
- **Estimated size:** S
- **Depends on:** task-001

## Goal
Implement loading/normalization of per-project `pi-studio.json` (worktree lifecycle + named scripts)
and the stale-write revision model.

## Scope references
- `clean-room-scope/architecture/config.md` § Per-project config, § Error Handling
- `clean-room-scope/features/worktrees.md` § Lifecycle config
- `clean-room-scope/features/service-proxy.md` § Triggering (service scripts)

## What to build
- Schema for `pi-studio.json`: `{ worktree?: { setup?: string|string[], teardown?: string|string[] },
  scripts?: Record<name, { type?: "service"|..., command: string, ... }>, instructions? }`.
- Normalize `setup`/`teardown`: a string → single-element array; drop blanks; default
  `{ setup: [], teardown: [] }`.
- `Pi-StudioConfigRevisionSchema` + write path returning errors: `project_not_found`,
  `invalid_project_config`, `stale_project_config` (disk changed since read), `write_failed`.

## Out of scope
- Running setup/teardown (sprint-008). Service proxy routing (sprint-009).

## Acceptance criteria
- [ ] `setup: "cmd"` normalizes to `["cmd"]`; absent → `[]`.
- [ ] `scripts` entries with `type:"service"` parse and are flagged for proxying.
- [ ] A write against a stale revision returns `stale_project_config`.
- [ ] Invalid project config returns `invalid_project_config`.

## Test / verification plan
- Tests: `npx vitest run .../pi-studio-config.test.ts` — normalization + each error code path.

## Notes
- Full script-entry schema (fields beyond `type`/`command`) is TODO(verify).
