import { describe, expect, it } from "vitest";
import { resolveMermaidThemeVariables } from "./mermaid-theme.js";

describe("resolveMermaidThemeVariables", () => {
  it("maps each mermaid theme key to its backing CSS custom property's value", () => {
    const resolved = resolveMermaidThemeVariables({
      "--pi-color-surface1": "#1E2120",
      "--pi-color-surface2": "#272A29",
      "--pi-color-surface3": "#434645",
      "--pi-color-surface4": "#595B5B",
      "--pi-color-foreground": "#fafafa",
      "--pi-color-foregroundMuted": "#A1A5A4",
    });

    expect(resolved.background).toBe("#1E2120");
    expect(resolved.primaryColor).toBe("#272A29");
    expect(resolved.primaryBorderColor).toBe("#434645");
    expect(resolved.lineColor).toBe("#A1A5A4");
    expect(resolved.textColor).toBe("#fafafa");
  });

  it("trims whitespace — getComputedStyle pads custom-property values with a leading space", () => {
    const resolved = resolveMermaidThemeVariables({ "--pi-color-surface1": "  #181B1A  " });
    expect(resolved.background).toBe("#181B1A");
  });

  it("omits a mermaid key entirely when its CSS var is missing or blank, rather than passing an empty string mermaid's color library can't parse", () => {
    const resolved = resolveMermaidThemeVariables({
      "--pi-color-surface1": "",
      "--pi-color-surface2": "   ",
    });
    expect(resolved.background).toBeUndefined();
    expect(resolved.primaryColor).toBeUndefined();
  });
});
