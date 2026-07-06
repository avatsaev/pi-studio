# Sprint-036 · Task-001 — Design-token alignment with Paseo — Report

## Summary
Aligned Pi-Studio's theme tokens (dark + light) with Paseo's
`~/DEV/paseo/packages/app/src/styles/theme.ts`, and fixed the theme→CSS-variable bridge so tokens
actually reach components. Work confined to `packages/app/src/theme/*` (token source + bridge). No
component files restructured; `packages/server` untouched.

## Key finding (root-cause fix)
The CSS bridge kebab-cased color var names (`--pi-color-foreground-muted`), but **~300 component
references use camelCase** (`--pi-color-foregroundMuted` ×97, `--pi-color-statusDanger` ×26,
`--pi-color-accentForeground`, `--pi-color-scrollbarHandle`, `--pi-color-surfaceSidebar`, …). Every
multi-word token therefore failed to apply and fell back to defaults — a major reason the UI looked
"broken/ugly". The bridge now emits color tokens **verbatim (camelCase)** to match component usage.
Single-word tokens (`surface0`, `border`, `accent`, spacing/radius/font keys) are unaffected; the
`--syntax-*` namespace is unused in CSS; no kebab multi-word references exist to break.

## What changed
- **`theme/css-bridge.ts`** — emit `--pi-color-<key>` verbatim (camelCase) instead of kebab-cased.
- **`theme/colors.ts`**
  - Split the single theme-invariant `STATUS` into `DARK_STATUS` (green-600/red-600/amber-500/purple-600)
    and `LIGHT_STATUS` (green-700/red-700/amber-600/purple-600) — matches Paseo's per-scheme status.
  - `DarkTintConfig` gains `surfaceDiffEmpty` (Paseo sets it per-tint, not derived from surface1).
  - `buildDarkColors`: `foreground` → `#fafafa` (zinc-50, was zinc-100); `surfaceWorkspace` → `surface1`
    (Paseo dark rule); `success` → theme accent; `diffDeletion` → `#ef4444` (red-500); status → dark set;
    `surfaceDiffEmpty` from tint. `accentForeground` still `contrastForeground(accent)` (a theme test
    requires this equality; the derived value matches Paseo's explicit values).
  - `buildLightColors`: rewritten to Paseo's `lightSemanticColors` exact hexes (surfaces, foreground
    `#1a1a1e`, foregroundMuted `#71717a`, accentBright `#239956`, destructive `#b04138`, borderAccent
    `#ececf1`, scrollbarHandle `#3f3f46`, surfaceSidebarHover `#e9e9ec`, surfaceDiffEmpty `#f6f6f6`,
    diff green-700/red-700, light status set).
- **`theme/variants.ts`** — all five dark tints (dark/zinc/midnight/claude/ghostty) set to Paseo's
  exact `*DarkColors` values, each with `surfaceDiffEmpty`; removed now-unused `palette` import.
- **`theme/paseo-tokens.test.ts`** (new) — asserts dark+light values match Paseo and that the bridge
  emits camelCase surface/multi-word vars (and not the old kebab forms).

## Surface roles (criterion-2)
`surface0..4`, `surfaceSidebar`, `surfaceSidebarHover`, `surfaceWorkspace`, `surfaceDiffEmpty` all
exist and the bridge emits e.g. `--pi-color-surfaceSidebar` = `#141716` (dark), distinct from
`--pi-color-surface0` = `#181B1A`.

## Validation
- `npx tsc -p packages/app/tsconfig.json --noEmit` → exit 0.
- `npx vitest run packages/app` → 77 files / 1298 tests pass (+9 new in paseo-tokens.test.ts).
- `npm run build:web` → built successfully (main entry ~202 kB).

## Notes
- Spacing, fontSize, fontWeight, borderRadius, iconSize, borderWidth, opacity, lineHeight already
  matched Paseo exactly — no change needed.
- Terminal ANSI palette left as Pi's palette-based mapping (not in the acceptance criteria; bg/fg/
  cursor track the correct surface/foreground/accent).
- `packages/server/*` files showing as recently modified are the concurrent sibling worker
  (production daemon), not this task.
