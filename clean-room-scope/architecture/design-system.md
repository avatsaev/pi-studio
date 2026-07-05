# Design System — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [client-app-runtime.md](client-app-runtime.md),
> [../features/ui-components.md](../features/ui-components.md),
> [../features/timeline-rendering.md](../features/timeline-rendering.md),
> [../features/localization.md](../features/localization.md),
> [../features/keyboard-shortcuts.md](../features/keyboard-shortcuts.md)

## Purpose

Defines the visual language and styling infrastructure shared by every Pi-Studio client screen and
component: the theme-token vocabulary (colors, spacing, type, radii), the six theme variants, the
responsive breakpoint system, the styling approach and its rules, and the overlay/portal
infrastructure. A from-scratch UI reimplementation should treat this document as the contract every
component "speaks".

> **Render-stack decision (Pi-Studio).** The reference app (Paseo) is a cross-platform
> Expo / React-Native-Web codebase. Pi-Studio ships **web + Electron only (no iOS/Android)** and
> therefore targets a **pure DOM stack: React 19 + Vite + CSS variables + CSS Modules**. The visual
> language, tokens, six theme variants, breakpoints, and overlay behavior below are preserved verbatim —
> only the *implementation medium* changes from React-Native primitives (`View`/`Text`, Unistyles
> `StyleSheet`) to DOM elements (`div`/`span`, CSS custom properties + CSS Modules). Where the original
> used Metro `.web`/`.native`/`.electron` platform-extension files, Pi-Studio uses runtime
> `getIsElectron()` gating plus build-time `import.meta.env` flags and dynamic `import()` so Electron-only
> modules are tree-shaken out of the pure-web bundle. See the pinned stack table below and
> [client-app-runtime.md](client-app-runtime.md) for the module-selection policy.

## Public Contract

### Theme token shape

A theme is an object `{ colorScheme, colors, spacing, fontSize, fontFamily, lineHeight, iconSize,
fontWeight, borderRadius, borderWidth, opacity, shadow }`. Components read tokens; they never hardcode
hex/px except for raw palette signal colors taken from `colors.palette`.

#### Colors — layer-based semantic system
| Token group | Tokens | Meaning |
|-------------|--------|---------|
| Surfaces | `surface0`..`surface4` | Elevation ramp: `surface0` = app background, `surface1` subtle, `surface2` = badges/inputs/sheets, `surface3` highest, `surface4` extra emphasis |
| Surfaces (special) | `surfaceDiffEmpty`, `surfaceSidebar`, `surfaceSidebarHover`, `surfaceWorkspace` | Empty diff side, sidebar bg + hover, workspace main bg |
| Text | `foreground`, `foregroundMuted` | Primary + secondary text |
| Brand | `accent`, `accentBright`, `accentForeground` | Brand accent, brighter variant, text-on-accent |
| Semantic | `destructive`, `destructiveForeground`, `success`, `successForeground` | Danger + success fills |
| Borders | `border`, `borderAccent` | Default + softer low-emphasis outline |
| Status | `statusSuccess`, `statusDanger`, `statusWarning`, `statusMerged` | Signal colors a step darker than raw palette (checks, PR states, review) |
| Diff | `diffAddition`, `diffDeletion` | Diff add/remove text colors |
| Controls | `scrollbarHandle` | Custom scrollbar handle |
| Legacy aliases | `background`, `popover`, `popoverForeground`, `primary`, `secondary`, `muted`, `mutedForeground`, `input`, `ring` | Migration aliases; new code uses the semantic tokens above |
| Nested | `colors.palette`, `colors.syntax`, `colors.terminal` | Raw color scales; syntax-highlight theme; xterm ANSI map |

- `colors.palette` exposes raw Tailwind-style scales (`zinc 50..950`, `gray`, `slate`, `blue`, `green`,
  `red`, `teal`, `amber`, `yellow`, `purple`, `orange`, `white`, `black`). Components reach into these
  only for **fixed signal colors** (e.g. a green success icon) that must not shift per theme.
- `colors.syntax` is the highlight token→color map (see [timeline-rendering.md](../features/timeline-rendering.md) §
  Syntax highlighting). `colors.terminal` is the full xterm theme (background/foreground/cursor/selection
  + 16 ANSI colors).

#### Scales (theme-invariant unless patched by Appearance settings)
| Scale | Values |
|-------|--------|
| `spacing` | `0,1=4,1.5=6,2=8,3=12,4=16,6=24,8=32,12=48,16=64,20=80,24=96,32=128` (px; 4px base) |
| `fontSize` | `xs=12, code=12, sm=14, base=16, lg=18, xl=20, 2xl=22, 3xl=26, 4xl=34` |
| `fontWeight` | `normal, medium=500, semibold=600, bold` |
| `borderRadius` | `none=0, sm=2, base=4, md=6, lg=8, xl=12, 2xl=16, full=9999` |
| `borderWidth` | `0, 1, 2` |
| `opacity` | `0, 50=0.5, 100=1` |
| `iconSize` | `xs=12, sm=14, md=16, lg=20` |
| `lineHeight` | `diff=22` (reserved for code/diff; prose uses `fontSize.base * ~1.4`) |
| `fontFamily` | `ui` (sans stack) and `mono` (monospace stack), platform default seeds |
| `shadow` | `sm/md/lg` (per-theme shadow color + offset/radius/elevation; dark themes use stronger alpha) |

- **`fontSize`, `fontFamily`, and `lineHeight` are deliberately widened to plain `number`/`string`**
  (not narrowed literals) so the Appearance settings updater can patch them at runtime (custom UI font,
  mono font, font size) across all themes. All other tokens keep literal types.
- Default UI font stack: system UI per platform (`system-ui` / `-apple-system` / Segoe / Roboto …).
  Default mono stack: `ui-monospace` / `SFMono-Regular` / Menlo / Monaco / Consolas / monospace.

### Theme variants

Six named themes. One light, five dark "tints" sharing one dark-theme builder that takes a tint config
(surfaces 0–4, sidebar surfaces, muted foreground, scrollbar, borders, accent, bright accent,
destructive) and produces the full semantic color set + a tinted terminal ANSI map.

| Theme name | Kind | Tint summary | Accent | Swatch |
|------------|------|--------------|--------|--------|
| `light` | light | white/zinc surfaces | green `#20744A` | `#ffffff` |
| `dark` | dark | subtle teal-green (default) | `#20744A` / bright `#7ccba0` | `#2D8B62` |
| `zinc` | dark | neutral gray, no tint | near-white `#e4e4e7` (dark text on accent) | `#808080` |
| `midnight` | dark | subtle blue | `#3b6fcf` | `#4A6BA8` |
| `claude` | dark | warm orange undertone | `#d97757` | `#D97757` |
| `ghostty` | dark | slate-blue (Ghostty bg) | `#89b4fa` | `#8caaee` |

- A theme-name→engine-key map and a theme-name→swatch-color map are exported for the Appearance picker.
- **Brand injection (white-label):** the accent family (`accent`, `accentBright`, `accentForeground`)
  and the picker swatch are not hardcoded to the default green — they come from the build-time brand
  config's `colors` (with bright/foreground auto-derived when omitted) and are applied uniformly across
  **all six** variants. Non-accent tokens are not brand-overridable in this version. See
  [../features/white-label-branding.md](../features/white-label-branding.md).
- Adaptive (system) light/dark following is enabled at the engine level; an explicit user theme
  overrides it. Appearance changes (theme, fonts, font size) are applied via a runtime theme update
  that repaints without a full reload (see [client-app-runtime.md](client-app-runtime.md) and the
  Appearance settings section of [../features/app-navigation-screens.md](../features/app-navigation-screens.md)).

### Breakpoints & layout constants
| Breakpoint | Min width |
|------------|-----------|
| `xs` | 0 |
| `sm` | 576 |
| `md` | 768 |
| `lg` | 992 |
| `xl` | 1200 |

- **Compact form factor** = breakpoint `xs` or `sm`. The reactive hook `useIsCompactFormFactor()` is the
  single source of truth for "phone-class layout" — never use platform OS as a layout proxy.
- Fixed layout constants: `HEADER_INNER_HEIGHT = 48` (desktop) / `HEADER_INNER_HEIGHT_MOBILE = 56`,
  `HEADER_TOP_PADDING_MOBILE = 8`, `WORKSPACE_SECONDARY_HEADER_HEIGHT = 36` (tab strip / panel toolbars),
  `FOOTER_HEIGHT = 75`, `MAX_CONTENT_WIDTH = 820` (chat/stream/input centered column),
  `COMPACT_FORM_FACTOR_WIDTH = 500` (per-container composer compaction threshold).
- Desktop window chrome: macOS traffic-light reserve `78×45`; Windows/Linux window controls `140×48`.
  Headers compute padding to avoid overlapping these (see ScreenHeader in
  [../features/ui-components.md](../features/ui-components.md)).
- `supportsDesktopPaneSplits()` is true only on web (the drag-and-drop split layout is web-only).

### Platform gating
| Gate | Type | Use for |
|------|------|---------|
| `isWeb` | constant | DOM APIs, web-only listeners, pane splits, paste, custom scrollbars |
| `isNative` | constant | Native-only APIs (haptics, camera, secure storage); "always show" hover controls |
| `getIsElectron()` | cached fn | Desktop bridge (browser panes, window controls, file dialogs, daemon supervision) |
| `useIsCompactFormFactor()` | reactive hook | Phone vs tablet/desktop layout decisions |

- Prefer **platform-extension files** (`.web.tsx` / `.native.tsx` / `.electron.tsx`, `.web.ts` /
  `.native.ts`) over large `if (isWeb)` blocks so unused platform code is never bundled. A shared `.d.ts`
  sibling provides the common type. Components with fundamentally divergent implementations (embedded
  browser, drag-reorder lists, terminal emulator, markdown text, audio capture, color scheme) use this.

## Behavior & Algorithms

### Styling-engine rules (reference: Unistyles v3)
These rules keep theme changes cheap (no React re-render) and prevent known crashes. A reimplementation
on a different engine should preserve the *intent* (theme-reactive styling without subtree re-renders).

1. **Default:** author styles as a theme-function (`create((theme) => ({...}))`). The engine tracks
   token dependencies and updates the native style tree directly on theme/breakpoint change — no
   component re-render.
2. **Static values:** hardcoded constants / static palette imports for genuinely theme-invariant values.
3. **Non-style props:** wrap leaf/3rd-party components with a theme-prop binder (`withUnistyles`) to feed
   theme-reactive **non-`style` props** (icon `color`, `tintColor`, `placeholderTextColor`, sheet
   background/handle styles) without subscribing the parent to runtime changes.
4. **The all-subscribing theme hook is discouraged** (it re-renders the whole subtree on any runtime
   change). Tolerated only where an icon color or a measured JS value genuinely needs a synchronous theme
   read; new code should prefer (1)–(3).
5. **Inline geometry seam:** high-churn measured geometry (popover positions, transforms) goes through an
   inline-style helper so it bypasses the web CSS registry while staying on the styling path. The
   floating-surface primitives own this seam.

#### Known gotchas to preserve
- Don't apply a theme-function style directly to an animated (Reanimated) view — it races the worklet and
  can crash; pass the themed color inline instead.
- A scroll view's content-container style is not theme-tracked; put themed backgrounds on a wrapper view.
- Bottom-sheet header content can remain mounted under a stale theme — paint leaf colors via the
  theme-prop binder or inline.

### Hover-to-show pattern
Hover only fires on web. Any control that is revealed on hover (copy buttons, row actions, archive
buttons, attachment remove, link affordances) computes visibility as:

```
visible = isHovered || isNative || isCompact
```

so it is **always visible** on touch/compact and hover-gated on desktop web. Hover is tracked either with
a pressable's hover callbacks + local state, or with `onPointerEnter/Leave` on an outer view — but raw
pointer-enter/leave is forbidden except inside `isWeb`-gated code (it does not fire on native and would
break touch). Never use pointer-enter/leave as a layout signal.

### Overlay & portal infrastructure
- **Web overlay root:** a single fixed, full-screen, pointer-events-none container into which modals and
  toasts portal, with a fixed z-order (`modal` below `toast`). Keeps stacking consistent above app chrome.
- **Native overlays:** transparent platform modal (no animation, status-bar-translucent on Android) plus a
  portal provider for popovers.
- **Floating-panel portal host:** a named, measurable region that anchored popovers (e.g. the composer
  autocomplete) attach to, so they can be positioned relative to a *panel* rather than the whole window.
  Each workspace registers its own named host.
- **Positioning engine (shared by dropdown/context menu/tooltip):** measure the trigger in window
  coordinates (adding the Android translucent-status-bar offset), measure content on layout, choose a side
  with auto-flip when space is insufficient, align start/center/end, and clamp to the screen with 8px
  padding. The resolved absolute top/left is fed through the inline-geometry seam.
- **Compact reroute:** on compact form factor, many anchored overlays (context menus, comboboxes, attach
  menus, control sheets) render as **bottom sheets** instead of anchored popovers.

## Data & Persistence
- The build-time brand config supplies the accent family + swatch (see
  [../features/white-label-branding.md](../features/white-label-branding.md)); it is immutable at
  runtime and independent of user Appearance settings.
- The active theme name, custom UI/mono fonts, and font size are user appearance settings; applying them
  patches the live theme tokens at runtime. Persistence of appearance settings follows the client store
  conventions in [persistence.md](persistence.md). `TODO(verify)`: exact appearance-settings storage key.

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Reanimated view + theme-function style | Avoid (crash); use inline themed color |
| Stale theme on sheet header | Repaint leaf color via prop binder / inline |
| Custom appearance font empty | Resolve to the platform default stack |
| Code/monospace surfaces on web | Tag them so a custom UI-font override does not replace the mono font |

## UI technology stack (pinned)
Pi-Studio ships **web + Electron only** and uses a **pure DOM React stack** (see the render-stack
decision in Purpose). Use these exact libraries unless a task documents a deliberate substitution.
Pi-Studio's own workspace packages use the `@av-pi-studio/*` scope. The right-hand "reference (Paseo)"
column records the original RN library each choice replaces, so the ported behavior stays recognizable.

| Concern | Library (version floor) | Replaces (Paseo RN) |
|---------|--------------------------|---------------------|
| App framework | `react` / `react-dom` (19.1) | expo / react-native / react-native-web |
| Build / dev server | `vite` (^6) + `@vitejs/plugin-react` | Metro / expo bundler |
| Routing | `react-router` (^7, data router) | expo-router / @react-navigation |
| Theming / styling | **CSS custom properties (design tokens) + CSS Modules**; `clsx` for class composition | react-native-unistyles |
| Client state | `zustand` (^5), `@tanstack/react-query` (^5), `use-sync-external-store` (^1.6) | (same) |
| Overlay positioning | `@floating-ui/react` (^0.27) | @floating-ui/react-native |
| Dialogs / menus / tooltips / popovers | `@radix-ui/react-dialog`, `-dropdown-menu`, `-tooltip`, `-popover` (^1) + `react-dom` portals | @gorhom/bottom-sheet, @gorhom/portal |
| Drag & drop | `@dnd-kit/core` (^6.3), `@dnd-kit/sortable` (^10), `@dnd-kit/utilities` (^3.2) | (same on web; RN draggable-flatlist dropped) |
| Animation | CSS transitions/animations; `framer-motion` (^11) where JS-driven motion is needed | react-native-reanimated / worklets |
| Icons | `lucide-react` (^0.5) | lucide-react-native / react-native-svg |
| List virtualization | `@tanstack/react-virtual` (^3.13) | (same) |
| Markdown | `react-markdown` (^9) + `remark-gfm` (^4) | react-native-markdown-display / markdown-it |
| Syntax highlighting | `@av-pi-studio/highlight` (workspace) + the syntax tokens here | (same) |
| Terminal emulator | `@xterm/xterm` (^6 beta) + addons (`addon-fit`, `addon-search`, `addon-webgl`, `addon-web-links`, `addon-clipboard`, `addon-image`, `addon-ligatures`, `addon-unicode11`); `@xterm/headless` for tests | (same) |
| Embedded browser pane | Electron `<webview>` (electron target only); web target renders a "desktop-only" placeholder | react-native-webview |
| Voice / audio | Web Audio API + `MediaRecorder`; `@av-pi-studio/audio` workspace helper | expo-audio / expo-two-way-audio |
| Camera / QR pairing | `getUserMedia` + a QR decode lib (`qr-scanner` ^1.4); `qrcode` (^1.5) for generation | expo-camera / qrcode |
| Persisted client storage | `localStorage` (web) / Electron settings bridge (electron) behind a `KeyValueStore` interface | @react-native-async-storage/async-storage |
| Images / attachments | `<input type=file>`, `File`/`Blob`, `URL.createObjectURL`, `navigator.clipboard` | expo-image(-picker/-manipulator), expo-clipboard/-sharing/-file-system |
| Localization | `i18next` (^26), `react-i18next` (^17) | (same) |
| Misc utilities | `fast-deep-equal` (^3), `tiny-invariant` (^1.3), `mnemonic-id` (^3), `clsx` (^2), `zod` (^3.23) | (same; buffer no longer needed) |

### Module-selection policy (Vite, replaces Metro platform extensions)
Metro's `.web` / `.native` / `.electron` file-extension resolution does not exist in Vite. Pi-Studio
achieves the same web-vs-Electron split three ways:
1. **Runtime gating** — `getIsElectron()` chooses behavior inside a shared module (e.g. browser pane
   placeholder vs `<webview>`, clipboard API vs Electron bridge).
2. **Build-time flags** — `import.meta.env.VITE_TARGET` (`web` | `electron`) lets Vite dead-code-eliminate
   the unused branch for each build.
3. **Dynamic `import()`** — Electron-only modules (SSH bridge, `<webview>` wrapper, native menu glue) are
   loaded via `await import(...)` guarded by `getIsElectron()`, so they never enter the pure-web chunk.

See [client-app-runtime.md](client-app-runtime.md) for the full policy and the `getIsElectron()` contract.

## Dependencies
- Internal: the highlight package (syntax token colors), client app runtime (applies appearance updates).
- External: see the pinned stack table above. The theming engine is `react-native-unistyles` v3; the icon
  set is `lucide-react-native`; SVG via `react-native-svg`.

## Acceptance Criteria
- [ ] Switching among the six theme variants recolors the entire UI without a reload and without a full
      React re-render of styled subtrees.
- [ ] Changing the Appearance UI font / mono font / font size patches the live theme and repaints prose,
      code, and tool-call surfaces.
- [ ] `useIsCompactFormFactor()` flips layouts at the `sm`→`md` boundary (576/768) and reroutes anchored
      overlays to bottom sheets on compact.
- [ ] Hover-revealed controls are always visible on native/compact and hover-gated on web.
- [ ] Code/monospace regions keep the mono font even when a custom UI font is applied.

## TODO(verify)
- [ ] Exact persistence key/shape for appearance settings.
- [ ] Whether adaptive (system) theme following can be combined with a tint preference, or only with
      `light`/`dark`.
- [ ] Final list of tokens that survive the legacy-alias migration.
