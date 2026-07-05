import { describe, expect, it, afterEach } from "vitest";

import {
  BrandConfigSchema,
  DEFAULT_BRAND,
  resolveBrandConfig,
  resolveAccentColors,
  getActiveBrand,
  _setActiveBrand,
  _resetActiveBrand,
  type BrandConfig,
} from "./config.js";
import { relativeLuminance } from "../theme/color-utils.js";
import { resolveBrandLogoAsset } from "./brand-logo.js";
import { buildBrandedThemes, injectBrandAccent } from "./theme-injection.js";
import { getTheme } from "../theme/theme.js";
import { isHexColor } from "../theme/color-utils.js";
import { THEME_NAMES } from "../theme/variants.js";

afterEach(() => { _resetActiveBrand(); });

// ---------------------------------------------------------------------------
// Default brand
// ---------------------------------------------------------------------------
describe("DEFAULT_BRAND", () => {
  it("productName is Pi-Studio", () => {
    expect(DEFAULT_BRAND.productName).toBe("Pi-Studio");
  });
  it("accent is the documented brand green", () => {
    expect(DEFAULT_BRAND.colors.accent).toBe("#20744A");
  });
  it("assets have logoLight, logoDark, icon", () => {
    expect(DEFAULT_BRAND.assets.logoLight).toBeTruthy();
    expect(DEFAULT_BRAND.assets.logoDark).toBeTruthy();
    expect(DEFAULT_BRAND.assets.icon).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// BrandConfigSchema validation
// ---------------------------------------------------------------------------
describe("BrandConfigSchema", () => {
  const VALID: BrandConfig = {
    productName: "Acme AI",
    colors: { accent: "#3b6fcf" },
    assets: { logoLight: "logo-light.svg", logoDark: "logo-dark.svg", icon: "icon.png" },
  };

  it("accepts a minimal valid config", () => {
    expect(BrandConfigSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects missing productName", () => {
    const { productName: _omit, ...rest } = VALID;
    const result = BrandConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors.some((e) => e.path.includes("productName"))).toBe(true);
    }
  });

  it("rejects invalid accent hex", () => {
    const result = BrandConfigSchema.safeParse({
      ...VALID,
      colors: { ...VALID.colors, accent: "notacolor" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors.some((e) => e.path.includes("accent"))).toBe(true);
    }
  });

  it("rejects missing required assets", () => {
    const { assets: _omit, ...rest } = VALID;
    expect(BrandConfigSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects empty logoLight", () => {
    const result = BrandConfigSchema.safeParse({
      ...VALID,
      assets: { ...VALID.assets, logoLight: "" },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveBrandConfig
// ---------------------------------------------------------------------------
describe("resolveBrandConfig", () => {
  it("returns default brand when no rawConfig provided", () => {
    const res = resolveBrandConfig();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.brand.productName).toBe("Pi-Studio");
      expect(res.source).toBe("default");
    }
  });

  it("returns env brand for valid raw config", () => {
    const raw = {
      productName: "Acme AI",
      colors: { accent: "#3b6fcf" },
      assets: { logoLight: "l.svg", logoDark: "d.svg", icon: "i.png" },
    };
    const res = resolveBrandConfig(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.brand.productName).toBe("Acme AI");
      expect(res.source).toBe("env");
    }
  });

  it("fills shortName from productName when omitted", () => {
    const raw = {
      productName: "Acme",
      colors: { accent: "#3b6fcf" },
      assets: { logoLight: "l.svg", logoDark: "d.svg", icon: "i.png" },
    };
    const res = resolveBrandConfig(raw);
    if (res.ok) expect(res.brand.shortName).toBe("Acme");
  });

  it("returns ok:false with field-level errors for invalid config", () => {
    const res = resolveBrandConfig({ productName: "", colors: {}, assets: {} });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.length).toBeGreaterThan(0);
      // Each error should be a "path: message" string
      expect(res.errors[0]).toContain(":");
    }
  });
});

// ---------------------------------------------------------------------------
// resolveAccentColors (derivation defaults)
// ---------------------------------------------------------------------------
describe("resolveAccentColors", () => {
  it("uses explicit values when provided", () => {
    const colors = { accent: "#3b6fcf", accentBright: "#628de8", accentForeground: "#ffffff", swatch: "#4a6ba8" };
    const resolved = resolveAccentColors(colors);
    expect(resolved.accent).toBe("#3b6fcf");
    expect(resolved.accentBright).toBe("#628de8");
    expect(resolved.accentForeground).toBe("#ffffff");
    expect(resolved.swatch).toBe("#4a6ba8");
  });

  it("derives accentBright when omitted (lightened accent)", () => {
    const resolved = resolveAccentColors({ accent: "#20744A" });
    expect(resolved.accentBright).not.toBe("#20744A");
    expect(isHexColor(resolved.accentBright)).toBe(true);
    // Derived bright should be lighter than original
    expect(relativeLuminance(resolved.accentBright)).toBeGreaterThan(relativeLuminance("#20744A"));
  });

  it("derives accentForeground as contrast-safe white or black", () => {
    const resolved = resolveAccentColors({ accent: "#20744A" });
    expect(["#ffffff", "#18181b"]).toContain(resolved.accentForeground);
  });

  it("defaults swatch to accent when omitted", () => {
    const resolved = resolveAccentColors({ accent: "#d97757" });
    expect(resolved.swatch).toBe("#d97757");
  });
});

// ---------------------------------------------------------------------------
// BrandLogo resolution
// ---------------------------------------------------------------------------
describe("resolveBrandLogoAsset", () => {
  const brand = DEFAULT_BRAND;

  it("auto + light colorScheme → logoLight", () => {
    expect(resolveBrandLogoAsset(brand, "auto", "light")).toBe(brand.assets.logoLight);
  });

  it("auto + dark colorScheme → logoDark", () => {
    expect(resolveBrandLogoAsset(brand, "auto", "dark")).toBe(brand.assets.logoDark);
  });

  it("explicit light → logoLight regardless of colorScheme", () => {
    expect(resolveBrandLogoAsset(brand, "light", "dark")).toBe(brand.assets.logoLight);
  });

  it("explicit dark → logoDark", () => {
    expect(resolveBrandLogoAsset(brand, "dark", "light")).toBe(brand.assets.logoDark);
  });

  it("mark → logoMark when present", () => {
    expect(resolveBrandLogoAsset(brand, "mark", "light")).toBe(brand.assets.logoMark);
  });

  it("mark falls back to wordmark when logoMark is absent", () => {
    const noBrand: BrandConfig = {
      ...brand,
      assets: { ...brand.assets, logoMark: undefined },
    };
    expect(resolveBrandLogoAsset(noBrand, "mark", "light")).toBe(noBrand.assets.logoLight);
    expect(resolveBrandLogoAsset(noBrand, "mark", "dark")).toBe(noBrand.assets.logoDark);
  });
});

// ---------------------------------------------------------------------------
// Theme accent injection
// ---------------------------------------------------------------------------
describe("injectBrandAccent", () => {
  it("replaces accent/accentBright/accentForeground/primary/ring", () => {
    const base = getTheme("dark");
    const resolved = { accent: "#3b6fcf", accentBright: "#628de8", accentForeground: "#ffffff", swatch: "#4a6ba8" };
    const branded = injectBrandAccent(base, resolved);

    expect(branded.colors.accent).toBe("#3b6fcf");
    expect(branded.colors.accentBright).toBe("#628de8");
    expect(branded.colors.accentForeground).toBe("#ffffff");
    expect(branded.colors.primary).toBe("#3b6fcf");
    expect(branded.colors.ring).toBe("#3b6fcf");
    expect(branded.swatch).toBe("#4a6ba8");
  });

  it("does not mutate the base theme", () => {
    const base = getTheme("dark");
    const originalAccent = base.colors.accent;
    const resolved = { accent: "#3b6fcf", accentBright: "#628de8", accentForeground: "#ffffff", swatch: "#4a6ba8" };
    injectBrandAccent(base, resolved);
    expect(base.colors.accent).toBe(originalAccent);
  });

  it("non-accent tokens are unchanged", () => {
    const base = getTheme("zinc");
    const resolved = { accent: "#d97757", accentBright: "#e89878", accentForeground: "#ffffff", swatch: "#d97757" };
    const branded = injectBrandAccent(base, resolved);
    expect(branded.colors.surface0).toBe(base.colors.surface0);
    expect(branded.colors.destructive).toBe(base.colors.destructive);
    expect(branded.colors.statusSuccess).toBe(base.colors.statusSuccess);
    expect(branded.spacing["4"]).toBe(16);
  });
});

describe("buildBrandedThemes", () => {
  it("produces a themed entry for all six variants", () => {
    const branded = buildBrandedThemes(DEFAULT_BRAND);
    for (const name of THEME_NAMES) {
      expect(branded[name]).toBeDefined();
      expect(branded[name].name).toBe(name);
    }
  });

  it("injects custom accent across all variants", () => {
    const custom: BrandConfig = {
      productName: "Acme",
      colors: { accent: "#9333ea" },
      assets: { logoLight: "l.svg", logoDark: "d.svg", icon: "i.png" },
    };
    const branded = buildBrandedThemes(custom);
    for (const name of THEME_NAMES) {
      expect(branded[name].colors.accent).toBe("#9333ea");
    }
  });
});

// ---------------------------------------------------------------------------
// getActiveBrand / _setActiveBrand
// ---------------------------------------------------------------------------
describe("getActiveBrand", () => {
  it("returns default brand initially", () => {
    expect(getActiveBrand().productName).toBe("Pi-Studio");
  });

  it("returns injected brand after _setActiveBrand", () => {
    const custom: BrandConfig = {
      productName: "Acme AI",
      colors: { accent: "#9333ea" },
      assets: { logoLight: "l.svg", logoDark: "d.svg", icon: "i.png" },
    };
    _setActiveBrand(custom);
    expect(getActiveBrand().productName).toBe("Acme AI");
  });
});
