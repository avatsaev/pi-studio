# Task 004 — Remove: every skill origin and whole packages

- **Sprint:** sprint-076-skills-remove-update
- **Status:** done
- **Type:** feature
- **Area:** packages/server (resources)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-001, task-003

## Goal

`skills_remove_request` removes a skill the way its origin requires, or a whole Pi package.

## Context / why

Brief D9/D20: never follow symlinks, keep the skills CLI lock consistent, never delete settings-path files.

## Scope references

- swe/architecture/pi-resource-management.md § Remove, § Error handling
- packages/server/src/resources/skill-catalog.ts, skills-rpc.ts (sprint-075)

## What to build

- `remove({path})`: package row ⇒ `not_removable`; `settings_path` ⇒ drop its entry (any ±form) from `settings.skills`, files untouched; symlinked dir ⇒ unlink the link; agents_dir with a lock entry ⇒ spawn `skills remove -g -y <name>`; plain dir under agent_dir/agents_dir ⇒ recursive delete, only if its realpath stays inside that origin root (else `not_removable`). Afterwards drop any ±pattern for that path from `settings.skills`.
- `remove({packageSource})`: spawn bundled `pi remove <source>` with `PI_CODING_AGENT_DIR`.
- Unknown path/package ⇒ `not_found`. Spawn failure ⇒ `remove_failed` + stderr. Always re-list.

## Out of scope

- UI (task-007)

## Acceptance criteria

- [x] Symlink removal leaves the target directory intact
- [x] Lock-tracked removal spawns `skills remove -g -y <name>` without `-a` (asserted on argv) and the row disappears
- [x] Settings-path removal leaves files on disk
- [x] A dir whose realpath escapes its root is refused and untouched
- [x] Package removal spawns `pi remove <source>`

## Test / verification plan

- `npx vitest run packages/server/src/resources` (temp HOME; fake spawn for CLI paths)
- `npm run build:server`
