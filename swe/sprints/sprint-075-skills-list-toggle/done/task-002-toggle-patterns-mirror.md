# Task 002 — `toggle-patterns.ts`: mirror of Pi's private skill toggle derivation

- **Sprint:** sprint-075-skills-list-toggle
- **Status:** done
- **Type:** feature
- **Area:** packages/server (resources)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** none

## Goal

A pure module that produces exactly the `settings.json` mutations `pi config` makes when a skill is enabled or disabled.

## Context / why

Pi exports no API for this; the logic lives in `config-selector.js` (`ResourceList`, lines 655-717). If this mirror is wrong, every toggle is wrong — so it is built and differential-tested first.

## Scope references

- swe/architecture/pi-resource-management.md § Ground truth (toggle pattern bullets), § Toggle
- node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/config-selector.js:655-717 (read, never import)
- packages/server/src/agent/providers/pi/thinking-levels.ts (precedent for a documented Pi mirror)
- Create: packages/server/src/resources/toggle-patterns.ts (+ .test.ts)

## What to build

Pure functions (no I/O):
- `topLevelPattern(path, baseDir | undefined, agentDir) → string` — `relative(baseDir ?? agentDir, path)`, POSIX separators.
- `packagePattern(path, baseDir) → string`.
- `replacePattern(entries: string[] | undefined, pattern, enabled) → string[]` — drop entries whose form with one leading `!`/`+`/`-` stripped equals `pattern`; append `(enabled ? "+" : "-") + pattern`.
- `applyPackageToggle(packages, source, pattern, enabled) → packages'` — upgrade a string entry to `{source}`, update its `skills` array, collapse back to the bare string when no filter array remains; other entries untouched; unknown source ⇒ throws.
- A header comment naming the mirrored Pi file/lines and version 1.4.0.

## Out of scope

- Reading or writing settings.json (task-004)
- Root AGENTS.md checklist line (task-007)

## Acceptance criteria

- [ ] For a fixed table of inputs (agentDir skill, `~/.agents` skill, package skill; prior `+`, `-`, `!`, absent entries; string vs object package entry) the output equals what Pi's `ResourceList` produces — table built by running Pi's own logic once (see Notes) and frozen as fixtures
- [ ] An existing same-pattern entry is replaced, never duplicated
- [ ] A package entry whose only filter is cleared collapses back to a string

## Test / verification plan

- `npx vitest run packages/server/src/resources/toggle-patterns.test.ts`
- `npm run build:server`

## Notes

Generate the fixture table with a throwaway script that drives Pi's `ResourceList` toggle against a temp `HOME`/`PI_CODING_AGENT_DIR` — **never the real home** (an earlier scope experiment leaked into `~/.pi/agent/settings.json`; set both env vars before importing Pi). Delete the script afterwards; keep only the frozen fixtures.
