# Task 005 — Localization + keyboard-shortcut system infra — Summary

- **Sprint:** sprint-012-ui-foundation
- **Completed:** 2026-07-05
- **Status:** done

## What was implemented

i18n locale resolution + English catalog, and the full keyboard-shortcut binding registry,
focus-scope resolver, combo dispatcher, and overrides store.

## Files created / changed

| File | Change |
|------|--------|
| `packages/app/src/i18n/locales.ts` | created — `SupportedLocale`/`AppLanguage` types, `SUPPORTED_LOCALES`, `DEFAULT_LOCALE`, `resolveSupportedLocale`, `isSupportedLocale` |
| `packages/app/src/i18n/resources/en.ts` | created — English translation catalog (canonical key shape) |
| `packages/app/src/i18n/instance.ts` | created — `createStubI18nController` (test/SSR); production i18next wiring deferred (not installed) |
| `packages/app/src/i18n/index.ts` | created — barrel re-export |
| `packages/app/src/shortcuts/registry.ts` | created — `ShortcutBinding`, `DEFAULT_BINDINGS` (15 default shortcuts) |
| `packages/app/src/shortcuts/dispatcher.ts` | created — `resolveKeyboardFocusScope`, `normalizeCombo`, `lookupBinding`, `dispatchShortcut`, `getShortcutPlatform` |
| `packages/app/src/shortcuts/overrides-store.ts` | created — `KeyboardShortcutOverridesStore` (set/get/remove/resetAll/serialize/deserialize), `OVERRIDES_STORAGE_KEY` |
| `packages/app/src/shortcuts/index.ts` | created — barrel re-export |
| `packages/app/src/i18n/i18n.test.ts` | created — 21 tests |
| `packages/app/src/shortcuts/shortcuts.test.ts` | created — 30 tests |
| `packages/app/src/index.ts` | modified — re-exports i18n + shortcuts |

## How it satisfies the scope

- **`resolveSupportedLocale`** — exact-then-prefix match over ordered system locales, `en` fallback.
  English-only catalog at this stage (other locale stubs removed per user direction; fallback handles them).
- **Stub i18n controller** — `t(key, opts)` with `{{var}}` interpolation; `changeLanguage` without
  remounting; isolatable per-test via `createStubI18nController`. Production i18next wiring is a
  thin wrapper once the package is installed.
- **`resolveKeyboardFocusScope`** — terminal (xterm class / data-testid) > command-center (when open) >
  message-input (input/textarea) > other; walks up to 10 levels of parentElement.
- **`lookupBinding`** — platform-aware combo lookup; overrides fully replace both platform variants;
  `suppressInTerminal` gate.
- **`KeyboardShortcutOverridesStore`** — in-memory with serialize/deserialize for AsyncStorage; `resetAll`;
  corrupt-JSON guard; storage key `@pi-studio:keyboard-shortcut-overrides`.

## Build & test results

```
$ npx vitest run packages/app/src/i18n/i18n.test.ts packages/app/src/shortcuts/shortcuts.test.ts
 ✓ packages/app/src/i18n/i18n.test.ts (21 tests)
 ✓ packages/app/src/shortcuts/shortcuts.test.ts (30 tests)
 Tests  51 passed (51)
```

## Acceptance criteria

- [x] `resolveSupportedLocale("system", locales)` picks exact-then-prefix match, falls back to `en`.
- [x] Stub controller's `changeLanguage` switches locale without re-creating the instance.
- [x] Terminal scope suppresses `suppressInTerminal=true` bindings; command-center / message-input
      scopes resolve correctly from element tagName / className / dataset.
- [x] Overrides replace the default combo; `resetAll` clears the store; round-trip serialize/deserialize.

## Follow-ups / TODO(verify)

- Install `i18next` + `react-i18next` when the Expo/RN runtime is set up; replace stub controller
  with `createI18nInstance()` using `createInstance()` + `compatibilityJSON:"v4"`.
- English-only at launch; other locales added in a future pass (locale stubs removed per user direction).
- AsyncStorage integration for the overrides store wired in the persistence sprint.
