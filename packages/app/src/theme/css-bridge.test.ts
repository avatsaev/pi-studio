/**
 * Tests for theme → CSS variables bridge and appearance controller.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { flattenThemeToVars } from "./css-bridge.js";
import { getTheme, applyAppearance, type AppearanceSettings } from "./theme.js";
import { THEME_NAMES, type ThemeName } from "./variants.js";
import {
  createAppearanceController,
  type KeyValueStore,
  type AppearanceMode,
} from "./appearance-store.js";

// Mock KeyValueStore
function createMockStore(): KeyValueStore & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    get(key: string) {
      return data[key] ?? null;
    },
    set(key: string, value: string) {
      data[key] = value;
    },
  };
}

describe("flattenThemeToVars", () => {
  it("produces --pi-color-* variables for all semantic tokens", () => {
    const theme = getTheme("dark");
    const vars = flattenThemeToVars(theme);

    expect(vars["--pi-color-surface0"]).toBeDefined();
    expect(vars["--pi-color-foreground"]).toBeDefined();
    expect(vars["--pi-color-accent"]).toBeDefined();
    expect(vars["--pi-color-destructive"]).toBeDefined();
    expect(vars["--pi-color-border"]).toBeDefined();
  });

  it("produces --pi-spacing-* variables", () => {
    const theme = getTheme("light");
    const vars = flattenThemeToVars(theme);

    expect(vars["--pi-spacing-1"]).toBe("4px");
    expect(vars["--pi-spacing-4"]).toBe("16px");
  });

  it("produces --pi-font-size-* variables", () => {
    const theme = getTheme("dark");
    const vars = flattenThemeToVars(theme);

    expect(vars["--pi-font-size-base"]).toBe("16px");
    expect(vars["--pi-font-size-xs"]).toBe("12px");
  });

  it("produces --pi-font-ui and --pi-font-mono", () => {
    const theme = getTheme("dark");
    const vars = flattenThemeToVars(theme);

    expect(vars["--pi-font-ui"]).toContain("system-ui");
    expect(vars["--pi-font-mono"]).toContain("ui-monospace");
  });

  it("produces --syntax-* variables from syntax colors", () => {
    const theme = getTheme("dark");
    const vars = flattenThemeToVars(theme);

    // The syntax map has keyword, string, comment, etc.
    expect(vars["--syntax-keyword"]).toBeDefined();
    expect(vars["--syntax-string"]).toBeDefined();
  });

  it("produces --pi-color-scheme matching theme colorScheme", () => {
    const light = getTheme("light");
    const dark = getTheme("dark");
    expect(flattenThemeToVars(light)["--pi-color-scheme"]).toBe("light");
    expect(flattenThemeToVars(dark)["--pi-color-scheme"]).toBe("dark");
  });

  it("produces consistent output for all six variants", () => {
    for (const name of THEME_NAMES) {
      const theme = getTheme(name);
      const vars = flattenThemeToVars(theme);
      // Should have at least 40 variables (colors + spacing + fonts + radii + ...)
      expect(Object.keys(vars).length).toBeGreaterThan(40);
      // All values should be strings
      for (const val of Object.values(vars)) {
        expect(typeof val).toBe("string");
      }
    }
  });

  it("reflects appearance overrides (custom font size)", () => {
    const base = getTheme("dark");
    const patched = applyAppearance(base, { fontSize: 20 });
    const vars = flattenThemeToVars(patched);

    // 20/16 = 1.25 scale, base was 16 → 20
    expect(vars["--pi-font-size-base"]).toBe("20px");
  });
});

describe("createAppearanceController", () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
  });

  it("initializes with default theme when store is empty", () => {
    const ctrl = createAppearanceController(store);
    const state = ctrl.getState();
    expect(state.mode).toBe("dark"); // DEFAULT_THEME_NAME
    expect(state.resolvedTheme.colorScheme).toBe("dark");
  });

  it("loads persisted mode from store", () => {
    store.set(
      "pi-studio-appearance",
      JSON.stringify({ mode: "light", settings: {} }),
    );
    const ctrl = createAppearanceController(store);
    expect(ctrl.getState().mode).toBe("light");
    expect(ctrl.getState().resolvedTheme.colorScheme).toBe("light");
  });

  it("setMode updates state and persists", () => {
    const ctrl = createAppearanceController(store);
    ctrl.setMode("zinc");
    expect(ctrl.getState().mode).toBe("zinc");
    expect(ctrl.getState().resolvedTheme.name).toBe("zinc");

    const persisted = JSON.parse(store.data["pi-studio-appearance"]!);
    expect(persisted.mode).toBe("zinc");
  });

  it("updateSettings patches and persists", () => {
    const ctrl = createAppearanceController(store);
    ctrl.updateSettings({ fontSize: 18 });
    expect(ctrl.getState().settings.fontSize).toBe(18);
    expect(ctrl.getState().resolvedTheme.fontSize.base).toBe(18);
  });

  it("system mode resolves based on matchMedia", () => {
    // In Node/vitest there's no real matchMedia, so it defaults to light (matches=false)
    const ctrl = createAppearanceController(store);
    ctrl.setMode("system");
    expect(ctrl.getState().mode).toBe("system");
    // Without matchMedia polyfill, should default to light (matches=false for dark query)
    expect(ctrl.getState().resolvedTheme.colorScheme).toBe("light");
  });

  it("applies brand overrides when brandConfig provided", () => {
    const brandConfig = {
      productName: "TestBrand",
      colors: { accent: "#ff0000" },
      assets: { logoLight: "l.svg", logoDark: "d.svg", icon: "i.png" },
      links: {},
      legal: {},
    } as any; // partial for test
    const ctrl = createAppearanceController(store, brandConfig);
    expect(ctrl.getState().resolvedTheme.colors.accent).toBe("#ff0000");
  });

  it("ignores corrupt store data gracefully", () => {
    store.set("pi-studio-appearance", "not json at all{{{");
    const ctrl = createAppearanceController(store);
    // Should fallback to defaults
    expect(ctrl.getState().mode).toBe("dark");
  });

  it("ignores unknown mode in store data", () => {
    store.set(
      "pi-studio-appearance",
      JSON.stringify({ mode: "unknown_theme", settings: {} }),
    );
    const ctrl = createAppearanceController(store);
    expect(ctrl.getState().mode).toBe("dark"); // fallback
  });
});
