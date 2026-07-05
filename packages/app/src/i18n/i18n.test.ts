import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  resolveSupportedLocale,
  SUPPORTED_LOCALES,
} from "./locales.js";
import { createStubI18nController } from "./instance.js";
import enResources from "./resources/en.js";

// ---------------------------------------------------------------------------
// Locale resolution
// ---------------------------------------------------------------------------
describe("SUPPORTED_LOCALES", () => {
  it("includes all 8 documented locales", () => {
    const expected = ["en", "ar", "es", "fr", "ja", "pt-BR", "ru", "zh-CN"];
    for (const l of expected) {
      expect(SUPPORTED_LOCALES).toContain(l);
    }
    expect(SUPPORTED_LOCALES).toHaveLength(8);
  });
});

describe("DEFAULT_LOCALE", () => {
  it("is 'en'", () => expect(DEFAULT_LOCALE).toBe("en"));
});

describe("isSupportedLocale", () => {
  it("returns true for supported locales", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("pt-BR")).toBe(true);
    expect(isSupportedLocale("zh-CN")).toBe(true);
  });
  it("returns false for unsupported values", () => {
    expect(isSupportedLocale("de")).toBe(false);
    expect(isSupportedLocale("system")).toBe(false);
    expect(isSupportedLocale("")).toBe(false);
  });
});

describe("resolveSupportedLocale", () => {
  it("non-system preference is returned directly", () => {
    expect(resolveSupportedLocale("fr", [])).toBe("fr");
    expect(resolveSupportedLocale("ja", ["en"])).toBe("ja");
  });

  it("exact system locale match", () => {
    expect(resolveSupportedLocale("system", ["fr", "en"])).toBe("fr");
  });

  it("skips unsupported locales, picks first match", () => {
    expect(resolveSupportedLocale("system", ["de", "es"])).toBe("es");
  });

  it("language-prefix match: 'pt' matches 'pt-BR'", () => {
    expect(resolveSupportedLocale("system", ["pt"])).toBe("pt-BR");
  });

  it("language-prefix match: 'zh' matches 'zh-CN'", () => {
    expect(resolveSupportedLocale("system", ["zh"])).toBe("zh-CN");
  });

  it("falls back to 'en' when no match", () => {
    expect(resolveSupportedLocale("system", ["de", "it"])).toBe("en");
    expect(resolveSupportedLocale("system", [])).toBe("en");
  });

  it("exact match wins over prefix (e.g. 'pt-BR' before 'pt')", () => {
    expect(resolveSupportedLocale("system", ["pt-BR"])).toBe("pt-BR");
  });

  it("system with mixed list picks first supported", () => {
    expect(resolveSupportedLocale("system", ["de", "zh-CN", "en"])).toBe("zh-CN");
  });
});

// ---------------------------------------------------------------------------
// English catalog — key shape sanity checks
// ---------------------------------------------------------------------------
describe("English catalog", () => {
  it("has sessions.title", () => {
    expect(enResources.sessions.title).toBe("Sessions");
  });
  it("has welcome.useThisComputer", () => {
    expect(enResources.welcome.useThisComputer).toBe("Use this computer");
  });
  it("has rewind keys", () => {
    expect(typeof enResources.rewind.tooltip).toBe("string");
    expect(typeof enResources.rewind.confirm).toBe("string");
  });
  it("has providerUsage keys", () => {
    expect(typeof enResources.providerUsage.title).toBe("string");
  });
  it("has settings.daemon.localDaemon", () => {
    expect(typeof enResources.settings.daemon.localDaemon).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Stub i18n controller
// ---------------------------------------------------------------------------
describe("createStubI18nController", () => {
  it("translates a key from the flat store", async () => {
    const ctrl = createStubI18nController({ "sessions.title": "Sessions" });
    expect(ctrl.t("sessions.title")).toBe("Sessions");
  });

  it("returns the key itself when not found", () => {
    const ctrl = createStubI18nController({});
    expect(ctrl.t("missing.key")).toBe("missing.key");
  });

  it("interpolates {{productName}}", () => {
    const ctrl = createStubI18nController({ "welcome.title": "{{productName}}" });
    expect(ctrl.t("welcome.title", { productName: "Pi-Studio" })).toBe("Pi-Studio");
  });

  it("changeLanguage switches language without re-creating the instance", async () => {
    const ctrl = createStubI18nController({ "sessions.title": "Sessions" });
    expect(ctrl.language).toBe("en");
    await ctrl.changeLanguage("fr");
    expect(ctrl.language).toBe("fr");
  });
});
