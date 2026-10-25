# Task 002 — Protocol: `detectSkillSource`, `skills_preview`, `skills_install`

- **Sprint:** sprint-077-skills-install
- **Status:** backlog
- **Type:** feature
- **Area:** packages/protocol
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

Shared source classifier plus preview/install schemas.

## Context / why

Client shows the detected kind live; the daemon re-runs detection authoritatively — one implementation in the zero-dep package.

## Scope references

- swe/architecture/pi-resource-management.md § Source kinds, § Wire family (preview, install; PreviewSkill)
- packages/protocol/src/index.ts (exports)

## What to build

- `detectSkillSource(input) → {kind, normalized} | null` covering every source-kind row (`npm:` with/without version, `git:` with ref, `owner/repo`, `owner/repo@skill`, GitHub/GitLab URLs incl. `/tree/<ref>/<path>`, `git@host:`, `ssh://`, `*.git`, absolute and `~` paths); relative paths, bare words, non-git `http(s)` file URLs ⇒ null.
- `skills_preview_request {source}` / response `{ok, error?, kind, source, skills: PreviewSkill[]}`.
- `skills_install_request {source, skills?, replace?}` / response `{ok, error?, results, skills, packages}`.
- `packages/protocol/AGENTS.md`.

## Out of scope

- Server/client behaviour

## Acceptance criteria

- [ ] Table test: every source-kind row (accept and reject) classified as the spec says
- [ ] Schemas parse the spec's shapes

## Test / verification plan

- `npx vitest run packages/protocol`
- `npm run build:protocol`
