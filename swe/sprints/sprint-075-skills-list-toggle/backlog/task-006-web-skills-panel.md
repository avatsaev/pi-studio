# Task 006 — Web: Settings → Skills panel (groups, rows, toggle, search)

- **Sprint:** sprint-075-skills-list-toggle
- **Status:** backlog
- **Type:** feature
- **Area:** packages/web-client (features/settings, features/skills)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-005

## Goal

The Skills category in Settings, listing every global skill grouped by origin, with working toggles and live refresh.

## Context / why

First user-visible slice: enable/disable from the browser.

## Scope references

- swe/features/skills-manager.md § Panel, § Data flow, § Toggle, § Error handling
- packages/web-client/src/features/settings/settings-categories.ts:30-60
- packages/web-client/src/features/settings/ (ModelProvidersPanel, viewers panel for patterns)
- Create: packages/web-client/src/features/skills/SkillsPanel.tsx (+ .module.css), skills-presentation.ts (+ test), use-skills.ts
- packages/web-client/AGENTS.md

## What to build

- Category `{id:"skills", label:"Skills", component: lazy(SkillsPanel), available: caps => caps.skills}` after `providers`; `SettingsCategoryCapabilities.skills`.
- `skills-presentation.ts` (pure, tested): group order (Pi skills, Agent Skills, one per package, Skill paths), empty groups hidden, row state (shadowed ⇒ muted + toggle disabled), badges, search filter, error-string → message (unknown strings verbatim).
- `use-skills.ts`: query; `onSkillsChanged` invalidates; optimistic toggle with rollback + inline row error.
- Panel: search box, collapsible groups, package headers with kind/curated/pinned badges, rows (name, ellipsized description, badges, toggle), footnote "Changes apply to newly started agent sessions.", `settings_unreadable` error state, curated first-toggle confirm, shared-pattern tooltip.
- Design tokens only; `rem` font sizes; buttons reset background/border/cursor.
- `packages/web-client/AGENTS.md`: Skills panel invariant.

## Out of scope

- Remove / Update all / Install buttons (sprints 076–077) — not rendered yet

## Acceptance criteria

- [ ] Category hidden when the daemon lacks `skills`
- [ ] Rows grouped and ordered as specified; search filters across groups
- [ ] Toggle off/on updates the row and survives a re-list; a failed toggle rolls back with an inline error
- [ ] A `skills_changed` push re-lists without user action
- [ ] Curated package: first toggle asks for confirmation

## Test / verification plan

- `npx vitest run packages/web-client/src/features/skills`
- `npm run build:web-client`; scoped `npx oxfmt <changed files>`
