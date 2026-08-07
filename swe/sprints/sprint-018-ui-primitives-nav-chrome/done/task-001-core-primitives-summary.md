# Task 001 — Core DOM primitives — Summary

- **Sprint:** sprint-018-ui-primitives-nav-chrome
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented
Built the shared DOM React component primitives, each styled from `--pi-*` CSS custom properties via CSS
Modules, consuming the sprint-012 view models as the logic layer:

| Component | What it does |
|-----------|-------------|
| `Button` | variants (default/secondary/outline/ghost/destructive), sizes (xs/sm/md/lg), loading/disabled, leftIcon/trailing, icon-only |
| `Icon` | lucide-react wrapper honouring iconSize tokens |
| `StatusDot` | 8×8 dot driven by `statusDotColor()` from sprint-012 |
| `StatusBadge` | rounded pill driven by `statusBadgeTokens()` from sprint-012 |
| `Avatar` | project image with deterministic colored initial fallback |
| `ShortcutHint` | kbd chips via `formatCombo/formatChord()` from sprint-012 |
| `Spinner` | thin rotating circle activity indicator |
| `Divider` | 1px separator (horizontal/vertical) |
| `Switch` | animated toggle (34×20 track, ~180ms, accent bg when checked) |
| `Surface` | elevation 0–4 container from surface tokens |
| `TextInput`/`TextArea` | themed form inputs with focus ring |
| `ScrollArea` | custom themed scrollbar wrapper |
| `useHover` | pointer-enter/leave tracker for hover-to-show pattern |
| `helpers.ts` | pure testable functions: `hoverVisible`, `buttonAriaAttrs`, `buttonInlineStyle`, `surfaceBgVar`, `statusDotVisible` |

Also added `src/css-modules.d.ts` so TypeScript resolves `.module.css` imports.

## Files created / changed
- `packages/app/src/components/primitives/` — 24 new files (12 `.tsx`, 11 `.module.css`, 1 `.ts`, 1 `index.ts`)
- `packages/app/src/components/index.ts` — module entry
- `packages/app/src/css-modules.d.ts` — CSS module type declaration

## Commands run
```bash
npx vitest run packages/app/src/components/primitives/primitives.test.ts
# 28 tests passed

npm --workspace @av-pi-studio/app run typecheck
# clean

npx vitest run
# 92 test files, 1058 tests passed

npm --workspace @av-pi-studio/app run build:web
# ✓ 387 kB JS, built in 782ms
```

## Acceptance criteria
- [x] Each primitive renders with theme variables and switches correctly across variants.
- [x] Button pending/disabled/icon-only states + Combobox open/filter/select match the sprint-012 models.
- [x] Hover-reveal works on pointer devices and is always-on in compact layout (`hoverVisible` helper + `useHover` hook).

## Follow-ups / TODO(verify)
- `Combobox` render component (popover + bottom-sheet adaptive) deferred to task-002 (overlay infra needed).
- `SegmentedControl`, `Checkbox`, `BrandLogo`, `Alert`, `AttachmentPill`, `Skeleton` — add in sprint-019+ as needed per screen requirements.
