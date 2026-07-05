// Supported locales + resolution algorithm.
// features/localization.md § Supported locales, § Resolution

export type SupportedLocale = "ar" | "en" | "es" | "fr" | "ja" | "pt-BR" | "ru" | "zh-CN";
export type AppLanguage = "system" | SupportedLocale;

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = [
  "en", "ar", "es", "fr", "ja", "pt-BR", "ru", "zh-CN",
];

export const DEFAULT_LOCALE: SupportedLocale = "en";

export const LOCALE_NATIVE_NAMES: Readonly<Record<SupportedLocale, string>> = {
  en: "English",
  ar: "العربية",
  es: "Español",
  fr: "Français",
  ja: "日本語",
  "pt-BR": "Português brasileiro",
  ru: "Русский",
  "zh-CN": "简体中文",
};

/**
 * Resolve the concrete `SupportedLocale` to activate given the user's preference
 * and the device/browser ordered locale list.
 *
 * Algorithm (localization.md § Resolution):
 * 1. If preference is not "system", return it directly.
 * 2. For each system locale (priority order):
 *    a. Exact match against SUPPORTED_LOCALES.
 *    b. Language-prefix match (e.g. "pt" matches "pt-BR").
 * 3. Return DEFAULT_LOCALE ("en").
 */
export function resolveSupportedLocale(
  preference: AppLanguage,
  systemLocales: string[],
): SupportedLocale {
  if (preference !== "system") return preference;

  for (const sysLoc of systemLocales) {
    // Exact match.
    if (isSupportedLocale(sysLoc)) return sysLoc as SupportedLocale;

    // Language-prefix match: "pt" should match "pt-BR", "zh" should match "zh-CN".
    // Prefer more specific matches first by iterating in SUPPORTED_LOCALES order.
    const langTag = sysLoc.split(/[-_]/)[0]?.toLowerCase();
    if (langTag) {
      for (const supported of SUPPORTED_LOCALES) {
        const supportedLang = supported.split("-")[0]?.toLowerCase();
        if (supportedLang === langTag) return supported;
      }
    }
  }

  return DEFAULT_LOCALE;
}

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
