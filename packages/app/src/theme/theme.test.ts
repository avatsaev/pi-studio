import { describe, expect, it } from "vitest";

import { contrastForeground, hexToRgb, isHexColor, lighten, relativeLuminance } from "./color-utils.js";
import { baseFontSize, DEFAULT_MONO_FONT, DEFAULT_UI_FONT, iconSize, spacing } from "./tokens.js";
import { THEME_NAMES, THEME_SWATCHES, THEME_VARIANTS, type ThemeName } from "./variants.js";
import { applyAppearance, DEFAULT_THEME_NAME, getTheme, type AppearanceSettings } from "./theme.js";

// ---------------------------------------------------------------------------
// color-utils
// ---------------------------------------------------------------------------
describe("hexToRgb", () => {
  it("parses 6-char hex", () => {
    expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb("#20744A")).toEqual({ r: 32, g: 116, b: 74 });
  });

  it("parses 3-char shorthand", () => {
    expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("throws on invalid input", () => {
    expect(() => hexToRgb("not-a-color")).toThrow();
    expect(() => hexToRgb("#gg0000")).toThrow();
  });
});

describe("relativeLuminance", () => {
  it("white is 1, black is 0", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 3);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 3);
  });

  it("mid-green is between 0 and 1", () => {
    const l = relativeLuminance("#20744A");
    expect(l).toBeGreaterThan(0);
    expect(l).toBeLessThan(1);
  });
});

describe("contrastForeground", () => {
  it("returns light text on dark background", () => {
    expect(contrastForeground("#000000")).toBe("#ffffff");
    expect(contrastForeground("#18181b")).toBe("#ffffff");
  });

  it("returns dark text on light background", () => {
    expect(contrastForeground("#ffffff")).toBe("#18181b");
    expect(contrastForeground("#f4f4f5")).toBe("#18181b");
  });
});

describe("lighten", () => {
  it("lighten by 0 returns same color", () => {
    const hex = "#20744A";
    const { r, g, b } = hexToRgb(lighten(hex, 0));
    const orig = hexToRgb(hex);
    expect(r).toBe(orig.r);
    expect(g).toBe(orig.g);
    expect(b).toBe(orig.b);
  });

  it("lighten by 1 returns white", () => {
    expect(lighten("#000000", 1)).toBe("#ffffff");
  });

  it("produces a lighter color", () => {
    const lighter = lighten("#20744A", 0.4);
    expect(relativeLuminance(lighter)).toBeGreaterThan(relativeLuminance("#20744A"));
  });
});

describe("isHexColor", () => {
  it("accepts valid 3 and 6 char hex", () => {
    expect(isHexColor("#abc")).toBe(true);
    expect(isHexColor("#aabbcc")).toBe(true);
    expect(isHexColor("#FFFFFF")).toBe(true);
  });
  it("rejects invalid values", () => {
    expect(isHexColor("red")).toBe(false);
    expect(isHexColor("#gg0000")).toBe(false);
    expect(isHexColor("#12345")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------
describe("spacing scale", () => {
  it("has the documented values", () => {
    expect(spacing["0"]).toBe(0);
    expect(spacing["1"]).toBe(4);
    expect(spacing["1.5"]).toBe(6);
    expect(spacing["2"]).toBe(8);
    expect(spacing["4"]).toBe(16);
    expect(spacing["8"]).toBe(32);
    expect(spacing["16"]).toBe(64);
    expect(spacing["32"]).toBe(128);
  });
});

describe("baseFontSize scale", () => {
  it("has the documented values", () => {
    expect(baseFontSize.xs).toBe(12);
    expect(baseFontSize.code).toBe(12);
    expect(baseFontSize.sm).toBe(14);
    expect(baseFontSize.base).toBe(16);
    expect(baseFontSize.lg).toBe(18);
    expect(baseFontSize.xl).toBe(20);
    expect(baseFontSize["2xl"]).toBe(22);
    expect(baseFontSize["3xl"]).toBe(26);
    expect(baseFontSize["4xl"]).toBe(34);
  });
});

describe("iconSize scale", () => {
  it("has the documented values", () => {
    expect(iconSize.xs).toBe(12);
    expect(iconSize.sm).toBe(14);
    expect(iconSize.md).toBe(16);
    expect(iconSize.lg).toBe(20);
  });
});

describe("default font stacks", () => {
  it("ui stack includes system-ui", () => {
    expect(DEFAULT_UI_FONT).toContain("system-ui");
  });
  it("mono stack includes ui-monospace", () => {
    expect(DEFAULT_MONO_FONT).toContain("ui-monospace");
  });
});

// ---------------------------------------------------------------------------
// Theme variants
// ---------------------------------------------------------------------------
describe("THEME_NAMES", () => {
  it("contains all six documented variants", () => {
    expect(THEME_NAMES).toContain("light");
    expect(THEME_NAMES).toContain("dark");
    expect(THEME_NAMES).toContain("zinc");
    expect(THEME_NAMES).toContain("midnight");
    expect(THEME_NAMES).toContain("claude");
    expect(THEME_NAMES).toContain("ghostty");
    expect(THEME_NAMES).toHaveLength(6);
  });
});

describe("THEME_SWATCHES", () => {
  it("every swatch is a valid hex color", () => {
    for (const name of THEME_NAMES) {
      const swatch = THEME_SWATCHES[name];
      expect(isHexColor(swatch), `swatch for ${name} is not a valid hex: ${swatch}`).toBe(true);
    }
  });

  it("light swatch is #ffffff", () => {
    expect(THEME_SWATCHES.light).toBe("#ffffff");
  });
});

describe("THEME_VARIANTS — color completeness", () => {
  const REQUIRED_COLOR_KEYS: (keyof import("./colors.js").ThemeColors)[] = [
    "surface0", "surface1", "surface2", "surface3", "surface4",
    "surfaceDiffEmpty", "surfaceSidebar", "surfaceSidebarHover", "surfaceWorkspace",
    "foreground", "foregroundMuted",
    "accent", "accentBright", "accentForeground",
    "destructive", "destructiveForeground",
    "success", "successForeground",
    "border", "borderAccent",
    "statusSuccess", "statusDanger", "statusWarning", "statusMerged",
    "diffAddition", "diffDeletion",
    "scrollbarHandle",
    "background", "popover", "popoverForeground",
    "primary", "secondary", "muted", "mutedForeground",
    "input", "ring",
  ];

  for (const name of THEME_NAMES) {
    it(`${name}: all semantic color keys present and are hex strings`, () => {
      const { colors } = THEME_VARIANTS[name];
      for (const key of REQUIRED_COLOR_KEYS) {
        const val = colors[key] as unknown;
        expect(typeof val, `${name}.colors.${key}`).toBe("string");
        expect(isHexColor(val as string), `${name}.colors.${key} = ${val}`).toBe(true);
      }
    });

    it(`${name}: has palette, syntax, terminal nested objects`, () => {
      const { colors } = THEME_VARIANTS[name];
      expect(colors.palette).toBeDefined();
      expect(typeof colors.palette.zinc["500"]).toBe("string");
      expect(colors.syntax).toBeDefined();
      expect(typeof colors.syntax.keyword).toBe("string");
      expect(colors.terminal).toBeDefined();
      expect(typeof colors.terminal.background).toBe("string");
    });

    it(`${name}: accentForeground contrasts with accent`, () => {
      const { colors } = THEME_VARIANTS[name];
      // Must be either near-black or near-white (contrast safe).
      expect([contrastForeground(colors.accent)]).toContain(colors.accentForeground);
    });
  }

  it("light colorScheme is 'light', all others are 'dark'", () => {
    expect(THEME_VARIANTS.light.colorScheme).toBe("light");
    for (const name of THEME_NAMES.filter((n) => n !== "light")) {
      expect(THEME_VARIANTS[name as ThemeName].colorScheme).toBe("dark");
    }
  });

  it("non-default variants (zinc/midnight/claude/ghostty) each have a distinct accent", () => {
    // light and dark intentionally share the same brand green (#20744A) per the spec.
    const distinctNames: ThemeName[] = ["zinc", "midnight", "claude", "ghostty"];
    const accents = distinctNames.map((n) => THEME_VARIANTS[n].colors.accent);
    const unique = new Set(accents);
    expect(unique.size).toBe(distinctNames.length);
  });

  it("light and dark share the documented brand green accent", () => {
    expect(THEME_VARIANTS.light.colors.accent).toBe("#20744A");
    expect(THEME_VARIANTS.dark.colors.accent).toBe("#20744A");
  });
});

// ---------------------------------------------------------------------------
// getTheme
// ---------------------------------------------------------------------------
describe("getTheme", () => {
  it("returns a theme with all scale tokens", () => {
    const t = getTheme("dark");
    expect(t.spacing["4"]).toBe(16);
    expect(t.fontSize.base).toBe(16);
    expect(t.iconSize.md).toBe(16);
    expect(t.fontWeight.semibold).toBe("600");
    expect(t.borderRadius.lg).toBe(8);
    expect(t.opacity["50"]).toBe(0.5);
    expect(t.lineHeight.diff).toBe(22);
  });

  it("default fontFamily uses platform defaults", () => {
    const t = getTheme("dark");
    expect(t.fontFamily.ui).toBe(DEFAULT_UI_FONT);
    expect(t.fontFamily.mono).toBe(DEFAULT_MONO_FONT);
  });

  it("default theme name is 'dark'", () => {
    expect(DEFAULT_THEME_NAME).toBe("dark");
  });
});

// ---------------------------------------------------------------------------
// applyAppearance
// ---------------------------------------------------------------------------
describe("applyAppearance", () => {
  const base = getTheme("dark");

  it("theme switch changes colorScheme and accent without mutating base", () => {
    const patched = applyAppearance(base, { themeName: "light" });
    expect(patched.colorScheme).toBe("light");
    expect(patched.name).toBe("light");
    // base is unchanged
    expect(base.colorScheme).toBe("dark");
  });

  it("custom uiFont patches fontFamily.ui only; mono stays default", () => {
    const patched = applyAppearance(base, { uiFont: "Inter, sans-serif" });
    expect(patched.fontFamily.ui).toBe("Inter, sans-serif");
    expect(patched.fontFamily.mono).toBe(DEFAULT_MONO_FONT);
  });

  it("custom monoFont patches fontFamily.mono only", () => {
    const patched = applyAppearance(base, { monoFont: "Fira Code, monospace" });
    expect(patched.fontFamily.mono).toBe("Fira Code, monospace");
    expect(patched.fontFamily.ui).toBe(DEFAULT_UI_FONT);
  });

  it("fontSize scales all font-size tokens proportionally", () => {
    // Setting fontSize=20 → scale=1.25; base 16 → 20, sm 14 → 18, xs 12 → 15
    const patched = applyAppearance(base, { fontSize: 20 });
    expect(patched.fontSize.base).toBe(20);
    expect(patched.fontSize.sm).toBe(Math.round(14 * (20 / 16)));
    expect(patched.fontSize.xs).toBe(Math.round(12 * (20 / 16)));
  });

  it("fontSize is clamped to [10, 24]", () => {
    const small = applyAppearance(base, { fontSize: 4 });
    expect(small.fontSize.base).toBe(Math.round(16 * (10 / 16)));

    const large = applyAppearance(base, { fontSize: 100 });
    expect(large.fontSize.base).toBe(Math.round(16 * (24 / 16)));
  });

  it("empty uiFont string reverts to platform default", () => {
    const patched = applyAppearance(base, { uiFont: "  " });
    expect(patched.fontFamily.ui).toBe(DEFAULT_UI_FONT);
  });

  it("non-font tokens (spacing, borderRadius, etc.) are unchanged after font patch", () => {
    const patched = applyAppearance(base, { uiFont: "Inter" });
    expect(patched.spacing["4"]).toBe(16);
    expect(patched.borderRadius.lg).toBe(8);
    expect(patched.iconSize.md).toBe(16);
  });

  it("combined settings: theme + fonts + size", () => {
    const settings: AppearanceSettings = {
      themeName: "midnight",
      uiFont: "Geist, sans-serif",
      monoFont: "JetBrains Mono, monospace",
      fontSize: 18,
    };
    const patched = applyAppearance(base, settings);
    expect(patched.name).toBe("midnight");
    expect(patched.colorScheme).toBe("dark");
    expect(patched.fontFamily.ui).toBe("Geist, sans-serif");
    expect(patched.fontFamily.mono).toBe("JetBrains Mono, monospace");
    expect(patched.fontSize.base).toBe(18);
    // Code surfaces keep mono font — ui patch did not touch it
    expect(patched.fontFamily.mono).not.toBe(DEFAULT_UI_FONT);
  });
});
