# Localization (i18n) — Clean Room Scope

> Part of: [MAIN-SCOPE.md](../MAIN-SCOPE.md)
> Related scopes: [app-navigation-screens.md](app-navigation-screens.md) § Settings,
> [../architecture/design-system.md](../architecture/design-system.md)

## Purpose

Pi-Studio's UI text is fully localizable. Every user-facing string in the app is a translation key,
not a hardcoded literal; the active language follows the user's explicit preference or the device's
system locale, and can be changed live (no reload) from Settings.

## Public Contract

### Supported locales
```ts
type SupportedLocale = "ar" | "en" | "es" | "fr" | "ja" | "pt-BR" | "ru" | "zh-CN";
type AppLanguage = "system" | SupportedLocale;
```
| Locale | Language | Native name |
|--------|----------|-------------|
| `system` | Follow device/browser locale | — |
| `en` | English (default/fallback) | English |
| `ar` | Arabic | العربية |
| `es` | Spanish | Español |
| `fr` | French | Français |
| `ja` | Japanese | 日本語 |
| `pt-BR` | Portuguese (Brazil) | Português brasileiro |
| `ru` | Russian | Русский |
| `zh-CN` | Chinese (Simplified) | 简体中文 |

### Settings surface
Settings → General → Language: a picker listing `system` + all supported locales (native names,
`system` shows a translated "System" label), persisted as a user preference. See
[app-navigation-screens.md](app-navigation-screens.md) § Settings information architecture.

## Behavior & Algorithms

### Resolution
```
resolveSupportedLocale(preference: AppLanguage, systemLocales: string[]): SupportedLocale
    if preference != "system": return preference
    for each systemLocale in systemLocales (device/browser priority order):
        match against SUPPORTED_LANGUAGES (exact, then language-only prefix, e.g. "pt-BR" before "pt")
        return the first match
    return DEFAULT_LOCALE ("en")
```
- Web reads `navigator.languages` (full ordered preference list); native reads
  `expo-localization`'s device locale list.

### Live language switching
```
I18nProvider (root):
    locale = resolveSupportedLocale(settings.language, systemLocales)
    if i18n.language != locale:
        i18n.changeLanguage(locale)   # async; errors are caught + logged, never thrown to the tree
    render children under <I18nextProvider i18n={i18n}>
```
- `changeLanguage` swaps every mounted `useTranslation()` consumer's strings without a remount —
  identical in spirit to the design system's live theme-token repaint (see
  [design-system.md](../architecture/design-system.md)).
- All translation resources are bundled up front (one JS module per locale), not fetched over the
  network — switching language is instant and works offline.

### Engine
- `i18next` + `react-i18next`, one shared instance created via `createInstance()` (not the global
  singleton, so tests can isolate it). `compatibilityJSON: "v4"`, `fallbackLng: "en"`,
  `interpolation.escapeValue: false` (the RN/React renderer already escapes), `react.useSuspense:
  false` (avoid Suspense boundaries around text).
- Every resource module (`resources/<locale>.ts`) exports a flat-ish nested key tree consumed via
  `t("namespace.key")`, e.g. `t("sessions.title")`, `t("rewind.tooltip")`,
  `t("composer.clientCommands.archiveAgent")`, `t("settings.general.language.options.ptBR")`.
  Namespaces roughly mirror feature areas (`sessions.*`, `schedules.*`, `settings.*`, `composer.*`,
  `rewind.*`, `shell.commandCenter.*`, `common.errors.*`, …).

## Data & Persistence
- The language preference (`AppLanguage`) persists via the client app-settings store (same store as
  other general settings). See [persistence.md](../architecture/persistence.md).

## Error Handling & Edge Cases
| Condition | Expected behavior |
|-----------|-------------------|
| `i18n.changeLanguage` rejects | Logged via the error reporter; UI keeps the previous language rather than crashing |
| Unrecognized system locale | Falls back to `en` |
| Missing translation key in a non-English locale | `i18next` fallback chain resolves to the `en` string |
| RTL locale (`ar`) | TODO(verify) — whether/how layout mirrors for RTL |

## Dependencies
- Internal: app-settings store (language preference), every screen/component (as `t()` consumers).
- External: `i18next`, `react-i18next`, `expo-localization` (native system-locale detection).

## Acceptance Criteria
- [ ] Selecting a language in Settings updates all currently-rendered strings without a reload.
- [ ] `system` preference resolves to the closest supported locale from the device's locale list,
      falling back to English.
- [ ] Every user-facing string in the catalog above resolves through a translation key, never a
      hardcoded literal, in newly-written UI code.
- [ ] Missing keys in a non-English locale silently fall back to the English string.

## TODO(verify)
- [ ] RTL layout handling for Arabic (mirrored navigation chrome, text alignment, icon flipping).
- [ ] Full enumeration of translation namespaces/keys (this doc is not an exhaustive key catalog —
      derive the full resource shape from `resources/en.ts` when implementing).
- [ ] Whether locale affects date/number formatting anywhere beyond plain string translation.
