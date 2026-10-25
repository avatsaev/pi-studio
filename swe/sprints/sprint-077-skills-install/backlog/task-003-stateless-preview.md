# Task 003 — Stateless preview: shallow clone or local folder → Pi skill loader

- **Sprint:** sprint-077-skills-install
- **Status:** backlog
- **Type:** feature
- **Area:** packages/server (resources)
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** task-002

## Goal

`skills_preview_request` lists the installable skills of an Agent Skills repo or a host folder, leaving nothing behind.

## Context / why

Brief D7 + R2: pick before install; no preview handle, no scratch kept.

## Scope references

- swe/architecture/pi-resource-management.md § Preview
- packages/server/src/resources/pi-sdk.ts (`loadSkillsFromDir`)
- packages/server/src/resources/resource-service.ts (queue, spawn runner)

## What to build

- Queued. Package kinds ⇒ `{ok:true, kind, skills: []}`. `local_path` ⇒ scan in place (expand `~` with `expandHome`; missing dir ⇒ `invalid_source`). `skills_repo` ⇒ `git clone --depth 1 [--branch ref]` into `mkdtemp($PI_STUDIO_HOME/tmp/preview-)` (120 s, prompt-guard env), honour a `/tree/<ref>/<path>` subpath.
- Rows: name, description, relPath, warnings, `valid` (name + description), `exists` (`~/.agents/skills/<sanitized>` present).
- No valid skills ⇒ `no_valid_skills`; clone failure ⇒ `preview_failed` + redacted stderr. Scratch removed in `finally`.

## Out of scope

- Installing

## Acceptance criteria

- [ ] A local fixture repo (file:// URL) with three skills, one invalid, previews three rows with the invalid one flagged
- [ ] No `preview-*` dir remains after success, failure, or timeout
- [ ] A host folder previews without being copied

## Test / verification plan

- `npx vitest run packages/server/src/resources` (local bare git repo fixture, temp HOME)
- `npm run build:server`
