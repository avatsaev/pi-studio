# Task 005 — Localization + keyboard-shortcut system infra

- **Sprint:** sprint-012-ui-foundation
- **Status:** backlog
- **Estimated size:** M
- **Depends on:** task-001

## Goal
Implement the two cross-cutting UI infrastructure systems every screen depends on: the localization
(i18n) engine and the global keyboard-shortcut dispatch system (bindings, focus-scope resolution,
customizable overrides). This is foundation-layer infra; wiring specific screens' strings/shortcuts
happens in their owning sprints (013–016).

## Scope references
- `clean-room-scope/features/localization.md` (all sections)
- `clean-room-scope/features/keyboard-shortcuts.md` (all sections)
- `clean-room-scope/features/composer-ui.md` § Keyboard shortcuts (composer-relevant) — the dispatcher
  this infra must support

## What to build
- **Localization:** an i18next + react-i18next instance (own `createInstance()`, not the global
  singleton), `compatibilityJSON: "v4"`, `fallbackLng: "en"`, `interpolation.escapeValue: false`,
  `react.useSuspense: false`; resource modules for all 8 supported locales (`ar, en, es, fr, ja,
  pt-BR, ru, zh-CN`) seeded with the English catalog's key shape (translation content itself can be
  stubbed/English-only initially — key coverage matters more than translation quality for this task);
  `resolveSupportedLocale(preference, systemLocales)` (exact-then-prefix match, `en` fallback);
  a live-switch provider (`I18nProvider`) that calls `changeLanguage` without remounting the tree.
- **Keyboard shortcuts:** the binding registry (action id, mac/non-mac key combo, help section), the
  focus-scope resolver (`message-input | terminal | command-center | other`), the action dispatcher
  (normalize combo → lookup by scope+platform+overrides → dispatch), a route-shortcut helper (scope a
  binding's lifetime to the mounted route), and the overrides store (`@…:keyboard-shortcut-overrides`
  in AsyncStorage, `staleTime: Infinity`).
- Export both systems' public hooks/providers so later sprints (composer, navigation, settings) can
  consume them without reaching into internals.

## Out of scope
- The Shortcuts-help dialog UI and the Settings → Shortcuts editor screen (sprint-013, alongside the
  Settings IA). The Settings → Language picker screen (sprint-013). Composer-specific binding wiring
  (sprint-015).

## Acceptance criteria
- [ ] Changing the resolved locale calls `i18n.changeLanguage` and every `useTranslation()` consumer
      re-renders with the new strings, without remounting the provider tree.
- [ ] `resolveSupportedLocale("system", systemLocales)` picks the first supported match (exact, then
      language-only prefix) and falls back to `en`.
- [ ] A keyboard event inside a terminal surface resolves to `"terminal"` scope; inside a text input,
      `"message-input"`; with the command center open and focus elsewhere, `"command-center"`.
- [ ] The dispatcher looks up bindings by scope + platform (mac vs non-mac) + any active override, and
      an override fully replaces a binding's default combo across both platform variants.
- [ ] Overrides persist across a reload (AsyncStorage) and `resetAll()` clears them.

## Test / verification plan
- Tests: `npx vitest run` for locale resolution, live-switch behavior (mock i18n controller), focus-scope
  resolution against synthetic DOM/target fixtures, dispatcher lookup/override precedence, overrides
  store persistence round-trip.

## Notes
- Keep both systems dependency-free of any specific screen; sprint-013's routing/settings tasks and
  sprint-015's composer task are the consumers.
