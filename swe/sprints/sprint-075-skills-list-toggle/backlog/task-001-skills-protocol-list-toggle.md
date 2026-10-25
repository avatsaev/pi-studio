# Task 001 — Protocol: `skills_list` / `skills_set_enabled`, `skills_changed` push, `skills` flag

- **Sprint:** sprint-075-skills-list-toggle
- **Status:** backlog
- **Type:** feature
- **Area:** packages/protocol
- **Priority:** P1
- **Estimated size:** S
- **Depends on:** none

## Goal

The wire contract for listing and toggling skills, plus the broadcast that tells every client to re-list.

## Context / why

Every later task in this sprint builds on these schemas. The family is a real `sessionMessageSchema` member set (viewer-settings precedent), flat snake_case, domain `{ok:false, error}` failures.

## Scope references

- swe/architecture/pi-resource-management.md § Wire family `skills_*` (list, set_enabled, skills_changed rows; SkillInfo / PiPackageInfo shapes; error vocabulary)
- packages/protocol/src/messages.ts (viewer_settings_* schemas are the pattern)
- packages/protocol/src/client-capabilities.ts:41-56 (`SERVER_FEATURES`), :63-96 (`SERVER_FEATURE_COMPAT`)
- packages/protocol/src/session-messages.test.ts
- packages/protocol/AGENTS.md

## What to build

- `skillsListRequestSchema` / `skillsListResponseSchema` — response `{ok, error?, message?, skills: SkillInfo[], packages: PiPackageInfo[]}`.
- `skillsSetEnabledRequestSchema` (`path`, `enabled`) / response (`ok, error?, skills, packages`).
- `skillsChangedSchema` — `{type:"skills_changed", reason}`; `reason` is a plain string (`"mutation" | "external"` documented, not an enum, so new reasons stay append-only).
- `skillInfoSchema`, `piPackageInfoSchema` exactly as the spec's shapes; `origin` is `z.string()` with the four documented values in a doc comment. All `.passthrough()`.
- Register all in the `sessionMessageSchema` union; export inferred types.
- `SERVER_FEATURES.skills` + COMPAT entry following the `compactionEvents` lines.
- `packages/protocol/AGENTS.md`: new family + flag.

## Out of scope

- preview / install / remove / update_all schemas (sprints 076–077)
- Any producer or consumer

## Acceptance criteria

- [ ] A list response with every SkillInfo field parses; one with an unknown `origin` string also parses
- [ ] A set_enabled request without `path` or `enabled` is rejected
- [ ] `skills_changed` with an unknown `reason` parses
- [ ] `SERVER_FEATURES.skills` exists with a COMPAT tag; existing capability tests pass

## Test / verification plan

- Extend `packages/protocol/src/session-messages.test.ts`
- `npx vitest run packages/protocol` and `npm run build:protocol`
