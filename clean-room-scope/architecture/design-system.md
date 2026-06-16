# Design System — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [client-app-runtime.md](client-app-runtime.md),
> [../features/ui-components.md](../features/ui-components.md),
> [../features/timeline-rendering.md](../features/timeline-rendering.md)

## Purpose

Defines the visual language and styling infrastructure shared by every Pi-Studio client screen and
component: the theme-token vocabulary (colors, spacing, type, radii), the six theme variants, the
responsive breakpoint system, the cross-platform styling engine and its rules, and the overlay/portal
infrastructure. A from-scratch UI reimplementation should treat this document as the contract every
component "speaks". It does not prescribe a specific styling library, but the reference behavior is
built on **Unistyles v3** (React Native) and the constraints below reflect that engine.

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
The clean-room app mirrors the original's stack (use these exact libraries unless a task documents a
deliberate substitution). Pi-Studio's own workspace packages use the `@av-pi-studio/*` scope.

| Concern | Library (version floor) |
|---------|--------------------------|
| App framework | `expo` (~54), `react-native` (0.81), `react-native-web` (~0.21), `react` / `react-dom` (19.1) |
| Navigation/routing | `expo-router` (~6), `@react-navigation/native` (^7) |
| Theming / styling engine | `react-native-unistyles` (^3.2) |
| Client state | `zustand` (^5), `@tanstack/react-query` (^5), `use-sync-external-store` (^1.6) |
| Overlay positioning | `@floating-ui/react-native` (^0.10) |
| Bottom sheets / portals | `@gorhom/bottom-sheet` (^5.2), `@gorhom/portal` (^1) |
| Drag & drop (web) | `@dnd-kit/core` (^6.3), `@dnd-kit/sortable` (^10), `@dnd-kit/utilities` (^3.2) |
| Drag / gestures (native) | `react-native-draggable-flatlist` (^4), `react-native-gesture-handler` (~2.28) |
| Animation | `react-native-reanimated` (~4.3), `react-native-worklets` (~0.8) |
| Icons | `lucide-react-native` (^0.546), `react-native-svg` (^15) |
| List virtualization | `@tanstack/react-virtual` (^3.13) |
| Markdown | `react-native-markdown-display` (^7), `markdown-it` (^10) |
| Syntax highlighting | `@av-pi-studio/highlight` (workspace) + the syntax tokens here |
| Terminal emulator | `@xterm/xterm` (^6 beta) + addons (`addon-fit`, `addon-search`, `addon-webgl`, `addon-web-links`, `addon-clipboard`, `addon-image`, `addon-ligatures`, `addon-unicode11`); `@xterm/headless` for tests |
| Embedded browser pane | `react-native-webview` (^13) |
| Voice / audio | `expo-audio` (~1), `@av-pi-studio/expo-two-way-audio` (workspace) |
| Camera / QR pairing | `expo-camera` (~17), `qrcode` (^1.5) |
| Text / layout chrome | `react-native-uitextview` (^2.2), `react-native-keyboard-controller` (^1.19), `react-native-edge-to-edge` (^1.7), `react-native-safe-area-context` (~5.6), `react-native-screens` (~4.16), `react-native-masked-view` (^0.3) |
| Persisted client storage | `@react-native-async-storage/async-storage` (2.2) |
| Images / attachments | `expo-image` (~3), `expo-image-picker` (^17), `expo-image-manipulator` (~14), `expo-clipboard`, `expo-sharing`, `expo-file-system` |
| Misc utilities | `fast-deep-equal` (^3), `tiny-invariant` (^1.3), `mnemonic-id` (^3), `buffer` (^6), `zod` (^3.23) |

The Metro platform-extension policy (`.web` / `.native` / `.electron`) selects between the web DnD
(`@dnd-kit`) vs native (`react-native-draggable-flatlist`), the xterm web build vs the WebView terminal
leaf, and similar splits. See [client-app-runtime.md](client-app-runtime.md) for the policy.

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
