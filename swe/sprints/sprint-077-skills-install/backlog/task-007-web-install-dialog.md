# Task 007 — Web: Install skill dialog

- **Sprint:** sprint-077-skills-install
- **Status:** backlog
- **Type:** feature
- **Area:** packages/web-client (features/skills)
- **Priority:** P1
- **Estimated size:** M
- **Depends on:** task-006

## Goal

Source → (preview & pick for repos/paths) → running → results.

## Context / why

Last user-visible slice.

## Scope references

- swe/features/skills-manager.md § Install dialog
- packages/web-client/src/features/skills/ (panel, presentation, hooks)
- Create: packages/web-client/src/features/skills/InstallSkillDialog.tsx (+ .module.css)

## What to build

- Toolbar Install skill… opens the dialog.
- Source step: live detected-kind label; package kinds show the skills-only + full-system-access notice and go straight to running.
- Pick step: rows with checkbox (default checked iff valid), warnings, invalid disabled with reason, `exists` rows need the Replace checkbox; Install button shows the exact source.
- Running: cannot resubmit; closing does not cancel. Results: per-item ✓/✗ with collapsible stderr.
- Presentation helpers (kind labels, step transitions) tested in `skills-presentation.test.ts`.

## Out of scope

- Upload tab (deferred)

## Acceptance criteria

- [ ] Unrecognised input disables Next
- [ ] Package source skips the pick step
- [ ] Existing-name rows require Replace before Install sends them
- [ ] Results render per item; list refreshes

## Test / verification plan

- `npx vitest run packages/web-client/src/features/skills`
- `npm run build:web-client`; scoped oxfmt
