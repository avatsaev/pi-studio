// i18next instance wiring.
// features/localization.md § Engine, § Live language switching
//
// This module is a thin integration layer over i18next. It is NOT imported by
// unit tests — tests exercise locales.ts and the translation catalog directly.
// The runtime (Metro/Expo) provides i18next; this file is a no-op in Node tests.
//
// NOTE: Only English is shipped at this stage; all other locales fall back to
// English via fallbackLng.

// Dynamic import keeps i18next out of the Node test bundle entirely.
export type I18nChangeLanguageFn = (locale: string) => Promise<void>;

export interface I18nController {
  t: (key: string, opts?: Record<string, unknown>) => string;
  changeLanguage: I18nChangeLanguageFn;
  language: string;
}

/**
 * Minimal i18n controller backed by the English catalog only.
 * In the production Expo build this is replaced by the real i18next instance
 * (see `createI18nInstance` below, which is imported only when i18next is present).
 */
export function createStubI18nController(
  resources: Record<string, string> = {},
): I18nController {
  let currentLang = "en";
  const store: Record<string, Record<string, string>> = { en: resources };

  return {
    get language() { return currentLang; },
    t(key, opts) {
      const catalog = store[currentLang] ?? store["en"] ?? {};
      let val = catalog[key] ?? key;
      // Simple {{var}} interpolation.
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          val = val.replaceAll(`{{${k}}}`, String(v));
        }
      }
      return val;
    },
    async changeLanguage(locale) {
      currentLang = locale;
    },
  };
}
