# `@av-pi-studio/ui-library` — AGENTS.md

Reusable React UI primitives, theme system and global styles, published for Pi-Studio client apps.
Consumed by `packages/web-client` (via a Vite alias to `src/`) and `packages/ui-gallery` (via the
built `dist`). Consumer guide: `README.md`. Visual language / token reference: `DESIGN_SYSTEM.md`.

---

## Purpose

Vite web SPAs and Electron renderers only: React `^19` (peer), no SSR, no React Native. The package
is **self-contained** — it must never import from `web-client` or any other `@av-pi-studio/*`
workspace package.

---

## Source layout

```
src/
  index.ts                     Root barrel (imports sentinel.css; re-exports everything below).
  breakpoints.ts               Breakpoints, layout constants, WINDOW_CHROME (React-free subpath).
  kv-store.ts                  `localStorageKvStore` — default KeyValueStore for ThemeBoundary.
  reset.css                    Generic opt-in global reset; shipped verbatim as dist/reset.css.
  sentinel.css                 `--piui-stylesheet` custom property read by the missing-styles.css warning.
  css-modules.d.ts  env.d.ts   Ambient typings (`*.module.css`, `process.env.NODE_ENV`).
  primitives/                  21 React primitives + `useHover` + `helpers.ts` (pure logic), each with a sibling `*.module.css`.
    index.ts                   Primitives barrel (`ScreenTitle` is deliberately absent).
  ui/                          Framework-free logic: button, combobox, status-dot, status-badge, toast, shortcut, avatar, screen-header, option-groups.
  theme/                       Token scales, palette, colors, six variants, Theme builder, CSS-variable bridge, appearance controller.
    index.ts                   React-free barrel (the `/theme` entry).
    ThemeBoundary.tsx          Provider + `useAppearance`/`useResolvedTheme`/`useAppearanceControls` (root-only: imports React).
    dev-warnings.ts            Pure once-per-page diagnostics (missing styles.css, second ThemeBoundary).
    token-guard.ts             `findTokenProblems`/`countTokenUsage` — pure token checker, exported from `/theme`.
  brand/                       `config.ts` (accent-only Zod schema, `resolveAccentColors`), `theme-injection.ts` (`injectBrandAccent`), `index.ts`.
  stores/                      `toast-store.ts`, `announcer-store.ts` — zustand module singletons.
scripts/pack-smoke.sh          npm pack → scratch Vite app → tsc / vite build / assertions (`KEEP_DIR=1` keeps the dir).
vite.config.ts                 Vite 6 library mode (see Build).
CHANGELOG.md  RELEASING.md     Breaking-change log; first-publish and rollback steps.
```

Tests are co-located `*.test.ts` (`theme/*.test.ts`, `ui/*.test.ts`, `stores/*.test.ts`).

---

## Public API (`package.json` `exports`)

Only these resolve; deep imports (`.../src/...`, `.../dist/...`) are rejected by the `exports` map.

| Specifier | Contents |
|-----------|----------|
| `.` | Everything: primitives, `ThemeBoundary` + hooks, stores, and all subpath modules |
| `./theme` | Theme/appearance logic, token tables, `findTokenProblems` — **React-free** |
| `./ui` | Pure UI logic — React-free |
| `./brand` | `BrandConfigSchema`, `resolveAccentColors`, `injectBrandAccent` — React-free |
| `./breakpoints` | Breakpoint constants — React-free |
| `./styles.css` | Required: all component CSS + `--piui-stylesheet` sentinel |
| `./reset.css` | Optional global reset |
| `./package.json` | Metadata |

Notes: `ThemeBoundary`, `useAppearance`, `useResolvedTheme`, `useAppearanceControls` are root-only.
`Menu` ships `MenuCursorTrigger/Content/Group/Item/Separator`; consumers install
`@radix-ui/react-dropdown-menu` themselves for `Root`/`Trigger`. `sideEffects` is `["**/*.css"]`.

---

## Build & commands

```bash
npm run build -w packages/ui-library    # vite build && tsc -b
npm run clean -w packages/ui-library
bash packages/ui-library/scripts/pack-smoke.sh
```

`vite build` (library mode) emits ESM entries `index`, `theme/index`, `ui/index`, `brand/index`,
`breakpoints` into `dist/`, **one** `dist/styles.css` with scoped class names
`piui-<Component>_<class>_<hash5>`, and copies `reset.css` verbatim. `tsc -b`
(`emitDeclarationOnly`) writes the `.d.ts` files. `ui-gallery` and the root `npm run build` need `dist`,
so build this package first (root order: protocol → relay → client → ui-library → server → web-client →
ui-gallery → cli).

---

## Invariants

- **No workspace imports.** Relative imports only inside the library; runtime deps are only those in
  `package.json` (radix, lucide-react, clsx, zustand, zod). Never `@av-pi-studio/*` or `web-client` paths.
- **Tokens only.** CSS reads `var(--pi-*)`/`var(--syntax-*)` with no fallback values and no literal
  `font-size` (use `var(--pi-font-size-<rung>)`; CSS font sizes are `rem` via the bridge). Enforced by
  `theme/token-guard.test.ts`.
- **React-free subpaths** (`theme/index.ts`, `ui/`, `brand/`, `breakpoints.ts`, and anything they
  import) must not import `react`. React code (`ThemeBoundary.tsx`, `primitives/`) is root-only.
- **Dev warnings use an inline `process.env.NODE_ENV === "production"` check** in `ThemeBoundary.tsx`.
  It must stay inline: the consumer's bundler folds it and drops the branch. Hiding it behind a helper
  function did not fold away in a consumer production build and the message strings survived. Vite 6
  library mode leaves the expression untouched. Consequence: a bundler is required.
- **One `ThemeBoundary` per document** (all instances write the same CSS variables on `<html>`) and
  **one copy of the library per app** (toast/announcer stores are module singletons).
- **CSS order:** consumers import library CSS before their own.
- **`ThemeBoundary` default `storageKey` is `pi-studio-appearance`** — unchanged so existing saved
  settings survive. Brand config is accent-only; an invalid one warns once and yields the unbranded
  theme, never throws. There is no brand singleton or `DEFAULT_BRAND`.
- **Deep imports are blocked by `exports`**; anything consumers need must be added to an entry barrel.
- **Docs:** changing a token, primitive or export means updating `DESIGN_SYSTEM.md` / `README.md`.

---

## Testing

Node-only Vitest (no DOM): token guard (`theme/token-guard.test.ts` runs `findTokenProblems` over this
package's own sources), `dev-warnings`, appearance store, `ui/*` logic and the two stores. Run from the
repo root (`npm test`; the root `vitest.config.ts` aliases the package to `src/`). Sibling guards:
`packages/web-client/src/design-tokens.test.ts`, `packages/ui-gallery/src/design-tokens.test.ts`.
`scripts/pack-smoke.sh` checks the packed tarball end to end (types, build, `exports`, CSS); it extracts
the README Quickstart between the `<!-- smoke:main.tsx -->` markers verbatim — do not edit that block
without keeping the script working.

---

## Release

Lockstep version with the other published packages (currently `0.0.115`), released by
`scripts/publish.sh` / `.github/workflows/release.yml` (order: protocol → relay → client → ui-library →
web-client → server → cli). Record breaking changes (removed/renamed export, changed prop, token rename)
in `CHANGELOG.md`. First publish and rollback: `RELEASING.md`.
