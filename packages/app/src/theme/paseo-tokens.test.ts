/**
 * Paseo design-token parity — asserts the theme token values match Paseo's
 * `~/DEV/paseo/packages/app/src/styles/theme.ts` (dark + light) and that the
 * CSS-variable bridge emits the surface roles in the camelCase form components
 * reference (e.g. `--pi-color-surfaceSidebar`).
 *
 * sprint-036-paseo-ux-parity / task-001
 */

import { describe, it, expect } from "vitest";
import { getTheme } from "./theme.js";
import { flattenThemeToVars } from "./css-bridge.js";

describe("Paseo token parity — dark (default)", () => {
  const c = getTheme("dark").colors;
  it("surfaces match Paseo paseoDarkColors", () => {
    expect(c.surface0).toBe("#181B1A");
    expect(c.surface1).toBe("#1E2120");
    expect(c.surface2).toBe("#272A29");
    expect(c.surface3).toBe("#434645");
    expect(c.surface4).toBe("#595B5B");
    expect(c.surfaceDiffEmpty).toBe("#252827");
    expect(c.surfaceSidebar).toBe("#141716");
    expect(c.surfaceSidebarHover).toBe("#1c1f1e");
    // Paseo dark: workspace surface = surface1.
    expect(c.surfaceWorkspace).toBe("#1E2120");
  });
  it("foreground / muted / accent / destructive match Paseo", () => {
    expect(c.foreground).toBe("#fafafa");
    expect(c.foregroundMuted).toBe("#A1A5A4");
    expect(c.accent).toBe("#20744A");
    expect(c.accentBright).toBe("#7ccba0");
    expect(c.destructive).toBe("#c64f43");
    expect(c.success).toBe(c.accent);
    expect(c.border).toBe("#252B2A");
    expect(c.borderAccent).toBe("#2F3534");
    expect(c.scrollbarHandle).toBe("#717574");
  });
  it("status + diff match Paseo dark", () => {
    expect(c.statusSuccess).toBe("#16a34a");
    expect(c.statusDanger).toBe("#dc2626");
    expect(c.statusWarning).toBe("#f59e0b");
    expect(c.statusMerged).toBe("#9333ea");
    expect(c.diffAddition).toBe("#4ade80");
    expect(c.diffDeletion).toBe("#ef4444");
  });
  it("sidebar surface differs from app background", () => {
    expect(c.surfaceSidebar).not.toBe(c.surface0);
  });
});

describe("Paseo token parity — light", () => {
  const c = getTheme("light").colors;
  it("surfaces match Paseo lightSemanticColors", () => {
    expect(c.surface0).toBe("#ffffff");
    expect(c.surface1).toBe("#fafafa");
    expect(c.surface2).toBe("#f4f4f5");
    expect(c.surface3).toBe("#e4e4e7");
    expect(c.surface4).toBe("#d4d4d8");
    expect(c.surfaceDiffEmpty).toBe("#f6f6f6");
    expect(c.surfaceSidebar).toBe("#f4f4f5");
    expect(c.surfaceSidebarHover).toBe("#e9e9ec");
    expect(c.surfaceWorkspace).toBe("#ffffff");
  });
  it("foreground / muted / accent / destructive match Paseo", () => {
    expect(c.foreground).toBe("#1a1a1e");
    expect(c.foregroundMuted).toBe("#71717a");
    expect(c.accent).toBe("#20744A");
    expect(c.accentBright).toBe("#239956");
    expect(c.destructive).toBe("#b04138");
    expect(c.borderAccent).toBe("#ececf1");
    expect(c.scrollbarHandle).toBe("#3f3f46");
  });
  it("status + diff match Paseo light", () => {
    expect(c.statusSuccess).toBe("#15803d");
    expect(c.statusDanger).toBe("#b91c1c");
    expect(c.statusWarning).toBe("#d97706");
    expect(c.statusMerged).toBe("#7c3aed");
    expect(c.diffAddition).toBe("#15803d");
    expect(c.diffDeletion).toBe("#b91c1c");
  });
});

describe("CSS-variable bridge emits camelCase surface roles", () => {
  const vars = flattenThemeToVars(getTheme("dark"));
  it("emits the surface-role vars components reference", () => {
    expect(vars["--pi-color-surfaceSidebar"]).toBe("#141716");
    expect(vars["--pi-color-surfaceSidebarHover"]).toBe("#1c1f1e");
    expect(vars["--pi-color-surfaceWorkspace"]).toBe("#1E2120");
    expect(vars["--pi-color-surface0"]).toBe("#181B1A");
    expect(vars["--pi-color-surface4"]).toBe("#595B5B");
  });
  it("emits camelCase multi-word tokens (not kebab)", () => {
    expect(vars["--pi-color-foregroundMuted"]).toBe("#A1A5A4");
    expect(vars["--pi-color-statusDanger"]).toBe("#dc2626");
    expect(vars["--pi-color-accentForeground"]).toBeDefined();
    expect(vars["--pi-color-scrollbarHandle"]).toBe("#717574");
    // The old kebab form must NOT be emitted (it silently broke tokens).
    expect(vars["--pi-color-foreground-muted"]).toBeUndefined();
    expect(vars["--pi-color-surface-sidebar"]).toBeUndefined();
  });
});
