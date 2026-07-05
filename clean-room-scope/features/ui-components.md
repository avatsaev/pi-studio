# Shared UI Components & Primitives — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [../architecture/design-system.md](../architecture/design-system.md),
> [app-navigation-screens.md](app-navigation-screens.md), [workspace-ui.md](workspace-ui.md),
> [composer-ui.md](composer-ui.md)

## Purpose

Defines the reusable UI primitive library the rest of the app composes from: pressables, inputs, icons,
surfaces/badges, lists/rows, overlays (modals, sheets, popovers, menus, tooltips), navigation chrome
(headers, sidebars), feedback (toasts, spinners, skeletons), status dots, and scroll/divider utilities —
plus the cross-cutting conventions (token consumption, hover, platform splits, overlay/portal infra) that
every primitive obeys. The token vocabulary and engine rules are in
[design-system.md](../architecture/design-system.md); this document is the component catalog.

## Public Contract

There is **no generic `<Card>` / `<Text>` / `<Divider>` / `<EmptyState>` primitive** — those are composed
per feature from views + tokens. The shared primitives are:

### Pressables
- **Button** — pressable + label. Variants: `default` (accent bg, white text), `secondary` (default,
  `surface3`), `outline` (transparent + accent border), `ghost` (transparent, muted → foreground on hover),
  `destructive`. Sizes `xs|sm|md|lg` (min-heights from 28; per-size icon size). Props: `leftIcon` (element /
  component / color-render fn; color derived from variant), `trailing`, `loading` (spinner + busy +
  disabled), style/text overrides. States: pressed → 0.85 opacity; disabled/loading → 50% opacity; ghost
  hover swaps text/icon to foreground. Row, centered, gap 8, radius lg.
- **Pressable convention:** interactive primitives use a pressable with a `style` callback of
  `{ pressed, hovered }` (hover is web-only, false on native).
- **Header toggle button** — a tooltip-backed icon button (`onPress`, tooltip label + shortcut keys + side);
  shares a responsive icon slot with the header icon badge; forwards expanded→aria-expanded on web.

### Inputs & form controls
- **Switch** — custom animated toggle (track 34×20, thumb 16, ~180ms timing). Track interpolates
  `surface3`→`accent`; disabled → 50%; switch role + checked state + hit slop.
- **SegmentedControl<T>** — generic segmented tabs: `options [{value,label,icon?,disabled?}]`, `value`,
  `onValueChange`, `size sm|md`, `hideLabels`. Container `surface2`; selected → `surface0` + subtle
  elevation + foreground text; hover/pressed (web, unselected) → `surface1`; disabled → 50%.
- **AdaptiveTextInput** — forward-ref input; on compact+native uses the bottom-sheet input, else a plain
  input. Deliberately uncontrolled (`initialValue`/`defaultValue` + a `resetKey` to remount) to avoid cursor
  jumps; placeholder/text color owned by the leaf via a theme-prop binder (leaf color last so callers can't
  inject a stale theme color). Web focus outline uses the accent.
- **Combobox** — the large adaptive searchable picker: desktop = a floating popover (flip/offset/shift/size);
  compact = a bottom sheet. Props include options, value, onSelect, renderOption, searchable,
  allowCustomValue (+ prefix/description/kind), placement, min-width, fixed-height, prevent-initial-flash
  (hide until coords resolve), keep-open-on-select, controlled open, anchor ref, and a structured header.
  Keyboard navigation + option building are factored out. Feature pickers (model selector, branch switcher,
  project picker, provider/host/ref pickers, GitHub picker) are built on it.
- Other form pieces: a question/answer form card (rendered in the stream), and audio-input controls
  (dictation controls, volume meter, realtime-voice overlay).

### Icons
- **Functional icons:** a single lucide-style set across primitives; sizes always via `iconSize` tokens,
  color via theme tokens passed as the `color` prop. Theme-reactive icons are wrapped with the theme-prop
  binder rather than read through the all-subscribing theme hook.
- **Brand/provider icons:** SVG components per provider (claude/codex/copilot/opencode/pi/…) and brands
  (github/discord/editor app icons/source-control panel icon). A provider-id→icon map
  resolves provider visuals. A Material file-icon set drives the file explorer.
- **`<BrandLogo>`** — the single product-logo component (`variant="auto|light|dark|mark"`), reading the
  build-time brand config's logo assets and picking light/dark by active `colorScheme`. Every product
  logo surface (splash, welcome, open-project, empty states, sidebar header) goes through it; no screen
  embeds a hardcoded logo. See [white-label-branding.md](white-label-branding.md).

### Surfaces / badges / chips / avatars
- **Alert** — inline callout: `title`, `description` (string/node), variant `default|info|success|warning|
  error` (icon + accent recolor border/title), optional actions. Transparent bg, 1px border, radius xl,
  alert role.
- **StatusBadge** — small pill: `label`, variant `success|error|muted`; radius full, 1px border, xs muted
  text.
- **Shortcut** — keyboard-shortcut chip(s): `keys` or `chord`, formatted per OS; single combo = one
  `surface2` badge, multi = a wrapped row.
- **ProjectIconView** (avatar) — image from a data URI, else a deterministic colored fallback with an
  initial letter (color derived from the project key). Size/shape owned by the caller.
- **AttachmentPill** — hover-reveal removable chip: body pressable (open) + close pressable (remove); remove
  visible when `isNative || isCompact || hovered`.
- Feature cards (plan card, question card, archived-agent callout, sidebar callout, context-window meter,
  diff-stat) are composed from views + tokens (`surface1/2`, border, radius xl, shadow), not a `<Card>`.

### Lists & rows
- Feature list/row compositions (agent list, sidebar workspace list/rows/header/grouping selector, provider
  catalog) read sidebar surface tokens + hover + status dots.
- **Reorderable lists** are platform-split: web uses drag-and-drop (the layout drag context); native uses
  gesture/animation. A sortable inline list backs tab reordering.
- The canonical "row" is the menu item (below): min-height 36, leading slot (16) + label (sm) + optional
  2-line muted description + trailing slot; hover/pressed → a surface bg.

### Overlays
- **FloatingSurface / FloatingScrollView** — own the geometry seam: flatten the frame style, strip engine
  metadata, and run it through the inline-style helper so high-churn position bypasses the web CSS registry
  while declarative styles stay tracked. Callers pass enter/exit animations.
- **Tooltip** (compound, Radix-style) — `open/defaultOpen/onOpenChange`, `delayDuration`, `enabledOnDesktop`
  (true) / `enabledOnMobile` (false). Desktop opens on hover / keyboard focus (only when the last input was
  keyboard, to avoid opening on focus restore); compact opens on press. Trigger supports `asChild`. Content
  has side/align/offset/max-width; web renders via a portal (not a focus-stealing modal); native uses a
  transparent modal + backdrop dismiss.
- **DropdownMenu** (compound) — root (controllable, dismisses keyboard on open), trigger (render-fn children
  of `{pressed,hovered,open}`), content (side/align/offset/width/max-height/full-width/scrollable; modal +
  backdrop + scale enter/exit; keep mounted through exit), item, label (uppercase muted), separator (1px),
  hint (xs footer). Items: `description`, `disabled`, `muted`, `destructive`, `selected` (leading or trailing
  check; accent variant), `status idle|pending|success` (spinner / green check + pending/success labels,
  disabling the item), `closeOnSelect`, `tooltip`, leading/trailing. iOS defers select until after dismissal.
- **ContextMenu** — parallel API but opens at the pointer/long-press point; web uses context-menu event,
  native long-press; compact can render as a bottom sheet (`mobileMode`).
- **AdaptiveModalSheet** — the primary modal/sheet: compact+mobile → bottom sheet (snap points, pan-to-close,
  themed bg/handle, keyboard-extend); desktop → centered card over a dimmed overlay (web portals into the
  overlay root; Esc-to-close via a shared key stack). Props: a structured header (`title/subtitle/back/
  leading/actions/search`), `visible/onClose`, `footer` (sticky), `snapPoints`, `desktopMaxWidth`,
  `onFilesDropped` (wrap in a drop zone), `scrollable`, `presentation`. A shared header view + inline header
  view + isolated bottom-sheet wrapper back it.
- **Autocomplete popover** — anchors an option list above a composer input using the floating-panel portal
  host measurement + keyboard animation + safe-area + the inline-geometry seam.
- Feature modals/sheets (add-host, pair-link, rename, project picker, keyboard-shortcuts dialog, workspace
  setup, command palette, attachment lightbox, tool-call sheet, import-session sheet) all build on these.

### Navigation chrome
- **ScreenHeader** — shared header frame: `surface0`, bottom border (removable), height 56 (mobile) / 48
  (desktop), safe-area + window-control padding, `left`/`right` slots, integrates the desktop titlebar drag
  region, no text selection. Variants: a menu header (sidebar toggle + title), a back header (back arrow +
  title + accessory), a header icon badge (non-interactive icon slot), and the canonical screen title (base
  size, lighter weight on desktop, single line).
- **Sidebars** — the left sidebar + explorer sidebar use dedicated sidebar surface tokens; pinned vs overlay
  by compact form factor; a sidebar separator divider. The split container + split drop zone + resize handle
  provide the web multi-pane layout.
- **No bottom tab-bar primitive** — navigation chrome lives in the router layouts; pane tabs live in the
  split container. `TODO(verify)`.

### Feedback
- **Toasts** — a host exposes `show(content,{icon,variant,durationMs,nativeAndroid})`, `copied(label?)`,
  `error(message)` (default ~2200ms; null = sticky; Android can delegate to the native toast). A single
  top-anchored viewport animates opacity + slide, pauses the dismiss timer on web hover, and portals into
  the overlay root on web; variants default/success/error.
- **Spinner** — a thin activity-indicator wrapper (`color` required, `size`); many primitives use the raw
  indicator. A longer-running "synced loader" exists for sync states.
- **Skeleton** — a pulsing placeholder (opacity loop) of bars/dots/title shapes (`surface2` views with token
  radii); used for the sidebar agent list, loading tabs, and loading tool-call details.
- **Error boundaries / overlays** — a host-route bootstrap boundary, an appearance-style boundary (repaints
  parsed content on appearance changes), and a quitting overlay. No single generic empty-state primitive —
  composed per screen.

### Status dots & avatars
- **AgentStatusDot** — an 8×8 round dot; props `status`, `requiresAttention`, `attentionReason
  (finished|error|permission)`, `pendingPermissionCount`, `showInactive`; derives a state bucket → color;
  returns nothing for missing/invalid status.
- Project avatars use the project icon view (above).

### Scroll & dividers
- The floating scroll view backs popover content. Web desktop renders a custom scrollbar overlay; a hook
  returns a platform style (web hides/themes the native scrollbar, native no-op). Sheet bodies use the
  bottom-sheet scroll view; desktop cards use a plain scroll view (mind the content-container theme-tracking
  gotcha). Dividers are 1px views with the border token (menu/sheet separators, sidebar separator).

## Behavior & Algorithms

### Token consumption & the discouraged hook
Tokens flow from the theme into every component via theme-function styles (tracked, no re-render) or the
theme-prop binder for non-style props. The all-subscribing theme hook is discouraged (re-renders the whole
subtree) and tolerated only where an icon color / measured value genuinely needs a synchronous theme read.
A clean-room reimplementation should prefer binder-wrapped icons + theme-function styles. See
[design-system.md](../architecture/design-system.md) § Styling-engine rules.

### Shared overlay positioning
Dropdown, context menu, and tooltip share one measure→flip→align→clamp positioning routine (8px screen
padding; Android translucent-status-bar offset), feeding an absolute top/left through the floating-surface
inline seam. Open state uses a shared controllable-open helper. On compact, anchored overlays reroute to
bottom sheets.

### Hover-to-show
Web-only; touch/compact always show controls (`isHovered || isNative || isCompact`). Raw pointer-enter/leave
only inside web-gated code. See [design-system.md](../architecture/design-system.md) § Hover-to-show.

### Platform splits
Components with divergent platform implementations use Metro extension files (embedded browser, drag/sortable
lists, markdown text, diff scroll, terminal emulator, sidebar callout slot; audio/color-scheme/scrollbar/
image-picker hooks). Import the base path and let the bundler pick the platform variant.

## Data & Persistence
- Primitives are stateless apart from local interaction state (hover/open/pressed). Preferences they surface
  (theme, fonts, preferred editor, grouping) persist via the client stores. See
  [persistence.md](../architecture/persistence.md).

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Overlay near a screen edge | Auto-flip side + clamp with padding |
| iOS select on a presented overlay | Defer the select until after dismissal (avoid UIKit hang) |
| Combobox before coords resolve | Hide until positioned (prevent a 0,0 flash) |
| Theme-function style on an animated view | Avoid (crash); pass themed color inline |
| Toast on web | Portal into the overlay root; pause timer on hover |

## Dependencies
- Pinned library versions: see [../architecture/design-system.md](../architecture/design-system.md) § UI technology stack.
- Internal: design system tokens + engine rules, overlay/portal infra, icon sets, the highlight package
  (where code is shown).
- External: a theming/styling engine, an icon set, SVG, a bottom-sheet library, a floating-positioning
  library (web), drag-and-drop (web).

## Acceptance Criteria
- [ ] Button/switch/segmented-control/combobox render all variants/states and consume only theme tokens.
- [ ] Dropdown, context menu, and tooltip share one positioning routine (flip/align/clamp) and reroute to
      bottom sheets on compact.
- [ ] The adaptive modal sheet is a centered card on desktop (Esc-to-close, overlay-root portal) and a bottom
      sheet on compact (snap/pan-to-close).
- [ ] Headers share one frame (height/border/safe-area/window-control padding) with menu/back/title variants.
- [ ] Toasts, spinners, skeletons, and the status dot behave per the catalog; hover-revealed controls are
      always visible on touch/compact.

## TODO(verify)
- [ ] Whether a shared empty-state / card / divider primitive exists beyond per-feature composition.
- [ ] Confirmation that the legacy template color map is fully dead.
- [ ] Internals of the synced loader and the autocomplete list component.
