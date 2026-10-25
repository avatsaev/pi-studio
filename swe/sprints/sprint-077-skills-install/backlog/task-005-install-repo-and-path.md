# Task 005 — Install Agent Skills repo picks and host-path entries

- **Sprint:** sprint-077-skills-install
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (resources)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002, task-003

## Goal

Install picked skills from a repo through the `skills` CLI, or register a host folder in `settings.skills`.

## Context / why

Brief D2/D7: the CLI keeps `.skill-lock.json` consistent; host paths are referenced, never copied.

## Scope references

- swe/architecture/pi-resource-management.md § Install (skills_repo, local_path)
- packages/server/src/resources/skills-cli.ts

## What to build

- `skills_repo`: `skills` required and non-empty; names already in `~/.agents/skills` without `replace` ⇒ `name_exists` results and excluded; one spawn `skills add <url> -g -a pi -y -s <picked…>`; per name ok iff `<agentsSkillsDir>/<sanitized>/SKILL.md` exists afterwards.
- `local_path`: append `+<absPath>` to `settings.skills` (no duplicates), `flush`; nothing copied.
- Unrecognised source ⇒ `invalid_source`.

## Out of scope

- Uploads (deferred, R4)

## Acceptance criteria

- [ ] Fake spawn: argv contains exactly the picked names; results per name from post-spawn existence
- [ ] Existing name without replace ⇒ `name_exists`, not spawned for that name
- [ ] Host path appears once in `settings.skills` and as a `settings_path` row

## Test / verification plan

- `npx vitest run packages/server/src/resources`
- `npm run build:server`
