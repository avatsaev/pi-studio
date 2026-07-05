# White-Label Branding — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [../architecture/design-system.md](../architecture/design-system.md),
> [app-navigation-screens.md](app-navigation-screens.md), [desktop-app.md](desktop-app.md),
> [ui-components.md](ui-components.md), [localization.md](localization.md)

## Purpose

The UI must ship as a **white-label product**: a reseller/operator can rebrand the app's **product
name/title**, **primary (accent) colors**, and **logo/icons** without touching component code. All
brand-specific values resolve from a **single build-time brand config**; when it is absent the app
falls back to the default **Pi-Studio** brand. This applies uniformly to the web build and the
Electron desktop build (and, where assets allow, native mobile builds).

Scope of this version is **build-time / per-distribution** branding only (a brand is chosen when the
app is built/packaged, not per-user and not per-connected-host). Runtime/daemon-delivered branding is
explicitly out of scope (see § Out of scope / TODO(verify)).

## Public Contract

### Brand config shape
A single resolved `BrandConfig` object is the one source of truth every branded surface reads from
(no component ever hardcodes the product name, an accent hex, or a logo path):

```ts
type BrandColors = {
  accent: string;            // primary brand color; overrides theme accent across ALL variants
  accentBright?: string;     // optional brighter variant (defaults: derived/lightened from accent)
  accentForeground?: string; // optional text-on-accent (defaults: auto contrast black/white)
  swatch?: string;           // optional Appearance-picker swatch color (defaults: accent)
};

type BrandConfig = {
  productName: string;       // "Pi-Studio" by default; window/document title, About, notifications app name
  shortName?: string;        // optional compact name (dock/taskbar/PWA short_name); defaults to productName
  tagline?: string;          // optional welcome subtitle override
  colors: BrandColors;
  assets: {
    logoLight: AssetRef;     // logo for light backgrounds (welcome/open-project/sidebar header)
    logoDark: AssetRef;      // logo for dark backgrounds
    logoMark?: AssetRef;     // optional square mark/monogram (compact spots, splash); defaults to logo*
    icon: AssetRef;          // app icon / favicon / dock / taskbar source (square, high-res)
    splash?: AssetRef;       // optional splash artwork; defaults to logoMark on surface0
  };
  links?: {                  // optional; replace default community/support/docs/issue targets
    docs?: string; support?: string; issues?: string; website?: string;
  };
  legal?: { copyright?: string; companyName?: string }; // About panel + desktop menus
};
```

- `AssetRef` is a build-resolvable asset reference (a path under the brand directory), consumed by the
  Metro asset pipeline (web/native) and by the desktop packaging step (icon/splash).
- Only `productName`, `colors.accent`, and `assets.{logoLight,logoDark,icon}` are **required** in a
  brand override; everything else has a documented default derived from those or from the Pi-Studio
  defaults.

### Resolution / override mechanism
```
brand config resolution (build time):
  if env PI_STUDIO_BRAND_DIR is set → load <dir>/brand.config.json + assets from <dir>
  else → use the built-in default Pi-Studio brand (packaged with the repo)
  validate against the BrandConfig schema (zod); fail the build with a clear error on invalid config
  freeze into a single importable `brand` module consumed everywhere
```

- Default location: a repo `brand/` directory holds the Pi-Studio default (`brand.config.json`,
  `logo-light.*`, `logo-dark.*`, `icon.*`). A reseller points `PI_STUDIO_BRAND_DIR` at their own copy.
- The config is validated at build time; missing required fields or unreadable assets fail fast.
- No secrets belong in the brand config; it is safe to commit/share.

### Consumers (one code path each — no scattered literals)
| Surface | What it reads | Notes |
|---------|---------------|-------|
| Theme builder | `colors.accent` (+ optional bright/foreground/swatch) | Injected into **all six** theme variants, replacing the default green; bright/foreground auto-derived when omitted. See [../architecture/design-system.md](../architecture/design-system.md) § Brand injection. |
| `<BrandLogo>` primitive | `assets.logoLight/logoDark/logoMark` | Single shared component; picks light/dark by active `colorScheme`; used by splash, welcome, open-project, empty states, sidebar header. See [ui-components.md](ui-components.md). |
| `useBrand()` / product-name string | `productName`, `shortName`, `tagline`, `links`, `legal` | All previously-literal "Pi-Studio" strings resolve through i18n interpolation of `productName` (see [localization.md](localization.md)) so translations stay brand-agnostic. |
| Web document | `productName` (title), `assets.icon` (favicon), `shortName`+`icon` (PWA manifest) | Set at build/boot. |
| Desktop shell | `productName` (`app.setName`, window title, About, updater feed naming), `shortName`+`icon` (dock/taskbar), `assets.icon`/`splash` (packaged app icon) | See [desktop-app.md](desktop-app.md) § Branding. |

## Behavior & Algorithms
- **Accent injection:** the dark-theme builder and the light theme take the brand accent as their accent
  input; when `accentBright`/`accentForeground` are omitted they are derived (lighten for bright,
  auto black/white contrast for foreground) so all six variants stay internally consistent. Non-accent
  tokens (surfaces, semantic status colors, syntax, terminal) are **not** brand-overridable in this
  version — only the accent family and swatch.
- **Logo selection:** `<BrandLogo variant="auto|light|dark|mark">` resolves against the active theme's
  `colorScheme`; `mark` falls back to the wordmark when no mark asset is provided.
- **Product name:** every user-visible occurrence is an i18n key interpolating `{{productName}}`; the
  raw string never appears in components or translation values.
- **Defaults:** with `PI_STUDIO_BRAND_DIR` unset the app is byte-for-byte the Pi-Studio brand — the
  feature adds no visible change to the default distribution.

## Data & Persistence
- Brand is **build-time immutable**; it is not a user setting and is not persisted in the client store.
  (It is distinct from the user's Appearance theme/font settings, which remain fully independent — a
  user still picks any of the six theme variants; only the accent family within them is rebranded.)

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| `PI_STUDIO_BRAND_DIR` unset | Use built-in Pi-Studio default brand |
| Brand config fails schema validation | Fail the build with a specific field-level error; never ship a half-branded app |
| Missing optional asset (mark/splash) | Fall back to the documented default (wordmark / mark-on-surface0) |
| Missing required asset (logoLight/logoDark/icon) | Build error |
| Accent with poor contrast on accentForeground | Auto-derived foreground uses contrast-safe black/white; a custom `accentForeground` is the operator's responsibility |
| Translations referencing the old literal name | Forbidden — copy must use the `{{productName}}` interpolation |

## Dependencies
- Internal: design-system theme builder (accent injection), `<BrandLogo>` primitive, localization
  (`{{productName}}` interpolation), desktop packaging + shell (app name/icon/About/updater).
- External: Metro asset pipeline (web/native), `electron-builder` (desktop icon packaging), `zod`
  (brand config validation).

## Acceptance Criteria
- [ ] With `PI_STUDIO_BRAND_DIR` unset, the app renders the default Pi-Studio name/accent/logo unchanged.
- [ ] Setting `PI_STUDIO_BRAND_DIR` to a valid brand dir changes the product name everywhere it appears,
      recolors the accent across all six theme variants, and swaps every logo/icon surface — with no
      component/source edits.
- [ ] An invalid brand config (missing required field / unreadable required asset) fails the build with
      a clear, field-level message.
- [ ] Omitted optional brand fields fall back to their documented defaults (bright/foreground derived,
      mark→wordmark, swatch→accent, shortName→productName).
- [ ] The desktop app window title, About panel, dock/taskbar name+icon, and packaged app icon all
      reflect the brand; the web document title + favicon + PWA manifest do too.
- [ ] No user-visible "Pi-Studio" string remains hardcoded in a component or a translation value.

## Out of scope / TODO(verify)
- [ ] Runtime or daemon-delivered (`server_info.brand`) per-host branding — deferred; would need a
      protocol amendment and precedence rules (build-time baseline < runtime override).
- [ ] Per-user in-app brand switching (this feature is per-distribution, not a user setting).
- [ ] Whether surfaces beyond the accent family (e.g. full palette theming) should be brand-overridable.
- [ ] Exact brand-asset formats/resolutions required per platform (favicon set, macOS `.icns`,
      Windows `.ico`, adaptive Android icon).
