# Task 001 — Theme system: tokens, variants, appearance application

- **Sprint:** sprint-012-ui-foundation
- **Status:** done
- **Estimated size:** M
- **Depends on:** task-002 (sprint-007, Pi-StudioClient facade)

## Goal
Implement the design-system token layer and the six theme variants, plus runtime appearance application
(theme switch, custom UI/mono fonts, font size) without a reload.

## Scope references
- `clean-room-scope/architecture/design-system.md` § Theme token shape, § Theme variants, § Behavior
  (appearance application)

## What to build
- The theme token object: `colors` (layer surfaces 0–4 + special surfaces, text, brand, semantic,
  borders, status, diff, `palette`, `syntax`, `terminal`, legacy aliases), `spacing`, `fontSize`,
  `fontFamily`, `lineHeight`, `iconSize`, `fontWeight`, `borderRadius`, `borderWidth`, `opacity`,
  `shadow` — exact values per the doc tables.
- Six registered themes: `light`, `dark` (teal-green default), `zinc`, `midnight`, `claude`, `ghostty`,
  built via the dark-theme-from-tint builder; theme-name→engine-key + theme-name→swatch maps.
- `fontSize`/`fontFamily`/`lineHeight` widened so an appearance updater can patch them at runtime across
  all themes; UI/mono default font stacks per platform.
- Appearance application: apply theme + custom fonts + font size via a runtime theme update; code/mono
  surfaces tagged so a custom UI font does not replace the mono font.

## Out of scope
- Styling-engine conventions/overlays (task-002). Component primitives (task-003,004). The Appearance
  settings screen UI (sprint-013).

## Acceptance criteria
- [ ] Switching among the six variants recolors the UI without reload and without re-rendering styled
      subtrees.
- [ ] Applying a custom UI/mono font + font size patches the live theme; code surfaces keep the mono font.
- [ ] All token tables from the doc are present with the documented values.

## Test / verification plan
- Tests: theme builder produces the documented tokens for each variant; appearance patch updates
  `fontSize`/`fontFamily` and leaves other tokens intact.

## Notes
- Appearance-settings storage key is TODO(verify).
