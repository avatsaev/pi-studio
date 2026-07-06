# Task 003 — Navigation screens parity (Home, Sessions, Schedules, Settings)

- **Sprint:** sprint-036-paseo-ux-parity
- **Status:** backlog
- **Estimated size:** L
- **Depends on:** task-001 (tokens)

## Goal
Match Paseo's look/rhythm for the top-level screens.

## Reference (Paseo)
- `screens/sessions-screen.tsx`, `screens/schedules-screen.tsx`, `screens/settings-screen.tsx`,
  `screens/settings/settings-section.tsx`, `screens/open-project-screen.tsx`, `screens/projects-screen.tsx`,
  `components/headers/screen-title.tsx`, `styles/settings.ts` (card + row primitives), `docs/design.md` §3,§5,§7.
- Pi-Studio: `packages/app/src/components/screens/{HomeScreen,SessionsScreen,SchedulesScreen,SettingsScreen}.tsx`
  and their `.module.css`, `packages/app/src/screens/*` view models.

## What to build
- **ScreenTitle** treatment (lighter weight on desktop) at the top of each screen.
- **Settings**: centered max-width 720 column; `SettingsSection` rhythm; rows-in-a-card with a single
  top border between rows (first row none); toggles/rows use the shared row primitive.
- **Sessions**: cross-host grouped list using the shared agent/session row (status, title, host,
  last-activity), ghost "Load more" footer.
- **Schedules**: same list/card language; empty states.
- **Home/open-project**: tiles/rows matching Paseo's calm spacing.
- Replace ad-hoc inline styles with the shared primitives (Button variants, StatusBadge, cards, rows).

## Acceptance criteria
- [ ] Each screen uses ScreenTitle + shared card/row/section primitives (no bespoke inline layouts).
- [ ] Spacing/weight/color hierarchy matches Paseo (spacious, quiet, `medium` section headers,
      `foregroundMuted` secondary text, ≤1 accent CTA per surface).
- [ ] App typecheck + vitest + `build:web` pass.

## Test / verification plan
- Visual: screenshot each screen; side-by-side with Paseo equivalents.
