# Task 001 — Design-token alignment with Paseo (foundation for all UI parity)

- **Sprint:** sprint-036-paseo-ux-parity
- **Status:** done
- **Estimated size:** M
- **Depends on:** none — **do first; tasks 002–006 depend on these tokens**

## Goal
Make Pi-Studio's theme tokens match Paseo's so every surface inherits the correct colors, surfaces,
spacing, radii, and typography. Reference: `~/DEV/paseo/packages/app/src/styles/theme.ts` and
`~/DEV/paseo/docs/design.md`.

## Key Paseo tokens to mirror (dark + light)
- **Surfaces**: `surface0` app bg, `surface1` subtle hover, `surface2` elevated (inputs/badges/sheets),
  `surface3` highest, `surface4` extra; `surfaceSidebar` (distinct from main), `surfaceSidebarHover`,
  `surfaceWorkspace`. Sidebar bg differs from main bg.
- **Foreground**: `foreground` (acted-on) vs `foregroundMuted` (context/secondary) — hierarchy via
  weight+color, NOT size.
- **Accent**: single CTA color; **destructive** only inside confirms.
- **Status**: success/danger/warning/merged (light + dark variants); diff addition/deletion.
- **Typography**: most text is `fontSize.base`/`fontSize.xs`; weights `normal` (content),
  `medium` (structural labels/section headers/modal titles), and lighter `ScreenTitle` (300–400).
- **Spacing/radii**: match the scale; generous row padding (16px settings, 8–12px sidebar rows).

## What to build
- Update `packages/app/src/theme/*` tokens + the theme→CSS-variable bridge so `--pi-color-*`,
  `--pi-space-*`, `--pi-radius-*`, `--pi-font-*` match Paseo values for dark and light.
- Add the missing surface roles (`surfaceSidebar`, `surfaceSidebarHover`, `surfaceWorkspace`,
  `surface0..4`) if absent.
- Verify existing components pick up the new variables (no hardcoded hex in components).

## Acceptance criteria
- [ ] Token values match Paseo's `theme.ts` (dark + light) for surfaces, foreground, accent, status, diff.
- [ ] `--pi-color-surfaceSidebar` etc. exist and differ from the main background.
- [ ] App typecheck + `npx vitest run packages/app` pass; `npm run build:web` succeeds.
- [ ] Visual: app background, sidebar background, and text hierarchy visibly match Paseo's calm, spacious look.

## Test / verification plan
- Unit: token snapshot tests for the theme map.
- Visual: screenshot Home + a workspace, compare tone/hierarchy to Paseo.
