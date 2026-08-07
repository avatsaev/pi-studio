# Keyboard Shortcuts System — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [composer-ui.md](composer-ui.md) § Keyboard shortcuts (composer-relevant),
> [app-navigation-screens.md](app-navigation-screens.md) § Settings (Shortcuts section),
> [workspace-ui.md](workspace-ui.md), [../architecture/design-system.md](../architecture/design-system.md)

## Purpose

Defines the app-wide keyboard shortcut system: the binding registry (action id, default key combo,
platform variant, help section), focus-scope resolution (so the same key can mean different things
in a terminal vs a text input vs the command center), the customizable-overrides store, the
shortcuts-help dialog, and the on-screen shortcut badges. Composer-local bindings (Enter/Escape/
dictation toggle/etc.) are cataloged in [composer-ui.md](composer-ui.md) § Keyboard shortcuts; this
document is the underlying dispatch system they, and every other global shortcut, run on.

## Public Contract

### Binding shape
```ts
type ShortcutSectionId = "navigation" | "tabs-panes" | "projects" | "panels" | "agent-input";

interface KeyboardShortcutHelpRow {
  id: string;            // binding id, e.g. "agent-new-cmd-shift-o-mac"
  label: string;
  labelKey: string;       // i18n key
  keys: ShortcutKey[];    // rendered combo, per-OS
  note?: string;
  noteKey?: string;
}

interface KeyboardShortcutHelpSection {
  id: ShortcutSectionId;
  title: string;
  titleKey: string;
  rows: KeyboardShortcutHelpRow[];
}
```
Each binding definition also carries: the action id it dispatches (`new-agent`, `toggle-command-center`,
`toggle-left-sidebar`, `toggle-right-sidebar`, `toggle-both-sidebars`, `toggle-focus`, `theme.cycle`,
`toggle-settings`, `show-shortcuts`, `cycle-agent-mode`, `dictation-toggle`, `dictation-confirm`,
`focus-message-input`, `message-input.action` (submit/queue), `agent.interrupt`, `voice.toggle`,
`voice.mute-toggle`, `archive-worktree`, …), a **mac** and **non-mac** key combo variant, and the
section it appears under in the help dialog.

### Default bindings (representative — see the shortcuts dialog for the full, current list)
| Section | Action | macOS | Windows/Linux |
|---------|--------|-------|----------------|
| projects | New agent | `⌘⇧O` | `Ctrl⇧O` |
| navigation | Toggle left sidebar | `⌘B` | `Ctrl.` |
| navigation | Toggle right sidebar (explorer) | `⌘E` | `Ctrl E` / `` Ctrl` `` |
| navigation | Toggle both sidebars | `⌘.` | `Ctrl.` |
| navigation | Toggle focus mode | — | — |
| navigation | Toggle settings | `⌘,` | `Ctrl,` |
| navigation | Toggle command center | `⌘K` | `Ctrl K` |
| navigation | Cycle theme | `⌘⇧T` | `Ctrl Alt T` |
| navigation | Show shortcuts dialog | `?` | `?` |
| agent-input | Focus message input | `⌘L` | `Ctrl L` |
| agent-input | Toggle dictation | `⌘D` | `Ctrl D` |
| agent-input | Confirm dictation | `Enter` (while dictating) | same |
| agent-input | Toggle realtime voice | `⌘⇧D` | `Ctrl⇧D` |
| agent-input | Mute/unmute voice | `Space` (while not editing) | same |
| agent-input | Cycle agent mode | `⇧Tab` | same |
| agent-input | Interrupt agent | `Escape` | same |

## Behavior & Algorithms

### Focus-scope resolution
Every key event is classified into a `KeyboardFocusScope` before dispatch, so the same physical key
can route differently:
```
resolveKeyboardFocusScope(event.target, commandCenterOpen):
    candidates = [event.target, event.target.parentElement, document.activeElement] (deduped)
    if any candidate is inside a terminal surface (data-testid or .xterm class) → "terminal"
    elif commandCenterOpen and a candidate is inside the command-center panel/input → "command-center"
    elif a candidate is a text input/textarea (composer or elsewhere) → "message-input"
    else → "other" (or "command-center" if open and no candidate at all)
```
- **Terminal scope**: most global shortcuts are suppressed so the terminal receives raw keys (the
  terminal pane owns its own key handling; see [feature-panels-ui.md](feature-panels-ui.md) §
  Terminal pane).
- **Message-input scope**: composer-specific bindings take priority (see
  [composer-ui.md](composer-ui.md) § Keyboard shortcuts); IME composition is always ignored.
- **Command-center scope**: the command center's own list navigation (arrows/enter/escape) wins;
  most global chords are suppressed while it's open except its own toggle (closes it).

### Dispatch
```
keyboardActionDispatcher.handle(event):
    scope = resolveKeyboardFocusScope(event.target, commandCenterOpen)
    combo = normalize(event) # ctrl/meta/alt/shift + key, OS-aware "mod" resolution
    binding = lookup(combo, scope, platform, overrides)
    if binding:
        event.preventDefault() / stopPropagation() per the binding's flags
        dispatch(binding.action, payload)
```
- `mod` in a chord means Cmd on macOS, Ctrl elsewhere (`getShortcutOs()`).
- Route-level shortcuts (e.g. only active on a workspace route) are registered/torn down by the
  owning screen; a **route-shortcut** helper scopes a binding's lifetime to a route.

### Customizable overrides
- Stored client-side as `Record<bindingId, comboString>` under the AsyncStorage key
  `@paseo:keyboard-shortcut-overrides` (React Query cache, `staleTime: Infinity`, so no network
  fetch — pure local state hydrated once).
- `setOverride(bindingId, combo)`, `removeOverride(bindingId)`, `resetAll()`; overrides fully replace
  a binding's default combo (both platform variants) when present.
- The Settings → Shortcuts section (desktop-only; see [app-navigation-screens.md](app-navigation-screens.md)
  § Settings) lists every binding grouped by section with an editable combo field, a reset-to-default
  per row, and a "reset all" action.

### Shortcuts-help dialog
- Opened by `?` (or the settings row); lists every `KeyboardShortcutHelpSection` in order
  (navigation → tabs-panes → projects → panels → agent-input), each row showing its formatted
  `Shortcut` chip(s) (see [ui-components.md](ui-components.md) § Surfaces) and label. Modal on
  desktop, bottom sheet on compact.
- A "show shortcut badges" preference toggles small inline shortcut hints next to the affordances
  they trigger (header buttons, menu items) app-wide.

## Data & Persistence
- `keyboard-shortcut-overrides` (AsyncStorage, see above).
- "Show shortcut badges" preference persists via the client preferences store. See
  [persistence.md](../architecture/persistence.md).

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| Shortcut pressed inside a terminal | Suppressed; terminal receives the raw key |
| Shortcut pressed while command center is open | Only command-center-local navigation + its own toggle fire |
| IME composition in progress | All shortcut dispatch ignored until composition ends |
| Override set to an already-used combo | TODO(verify) — conflict detection/warning behavior |
| Native app (no hardware keyboard) | Shortcuts system is inert; iOS hardware-keyboard Enter-submit is a separate, composer-local path |

## Dependencies
- Internal: focus-scope resolver, action dispatcher, route-shortcut helper, shortcut-string
  formatter (OS-aware chord → display text), the Shortcut chip primitive, i18n (labels).
- External: none beyond the app framework's key-event APIs (web `keydown`, Electron accelerator
  passthrough where applicable).

## Acceptance Criteria
- [ ] Every documented default binding dispatches its action on the correct platform variant.
- [ ] Shortcuts are suppressed inside a focused terminal so the terminal receives raw keys.
- [ ] Overrides persist across reloads and fully replace the default combo for a binding.
- [ ] The shortcuts-help dialog lists all sections/rows with correctly formatted per-OS chips.
- [ ] The Settings → Shortcuts section (desktop-only) can edit and reset individual bindings and
      reset all at once.

## TODO(verify)
- [ ] Conflict detection/warning when a user override collides with another binding.
- [ ] The full, current list of binding ids/action ids (this doc's table is representative, not
      exhaustive — enumerate from the live binding registry when implementing).
- [ ] Whether any bindings are registered for native (hardware-keyboard) use beyond composer submit.
