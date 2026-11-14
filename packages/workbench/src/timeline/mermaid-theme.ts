/**
 * Mermaid's `base` theme override for inline chat diagrams (`MermaidBlock` in `markdown.tsx`).
 *
 * Unlike `features/files/molecule-theme.ts`'s `<MolViewer>` override — where `var(--pi-color-*)`
 * REFERENCES are handed to the component and the browser resolves them later through the normal
 * CSS cascade — mermaid's theme engine (`khroma`) computes derived shades (lighten/darken,
 * contrast text) from each color at render time, in JS, before any CSS reaches the DOM. It needs
 * real resolvable color strings (hex/rgb/hsl), not `var()` references, which `khroma` cannot
 * parse. So these are read from the live computed style instead of passed through as literals.
 */

/** mermaid `themeVariables` key -> the pi-studio CSS custom property backing it. */
const MERMAID_VAR_MAP: Record<string, string> = {
  background: "--pi-color-surface1",
  primaryColor: "--pi-color-surface2",
  primaryTextColor: "--pi-color-foreground",
  primaryBorderColor: "--pi-color-surface3",
  lineColor: "--pi-color-foregroundMuted",
  secondaryColor: "--pi-color-surface3",
  secondaryTextColor: "--pi-color-foreground",
  secondaryBorderColor: "--pi-color-surface4",
  tertiaryColor: "--pi-color-surface1",
  tertiaryTextColor: "--pi-color-foreground",
  tertiaryBorderColor: "--pi-color-surface3",
  textColor: "--pi-color-foreground",
};

/**
 * Pure: maps an already-read `{ cssVarName: value }` snapshot onto mermaid's `themeVariables`
 * shape. Split out from `readMermaidThemeVariables` below so the mapping itself is unit-testable
 * without touching `document` — same rationale as `molecule-source.ts`'s split from
 * `@molviewer/core`.
 */
export function resolveMermaidThemeVariables(
  cssVars: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [mermaidKey, cssVar] of Object.entries(MERMAID_VAR_MAP)) {
    const value = cssVars[cssVar]?.trim();
    if (value) resolved[mermaidKey] = value;
  }
  return resolved;
}

/** Reads pi-studio's current theme off `document.documentElement`'s computed custom properties
 *  and resolves them into mermaid's `themeVariables` shape. Read once per diagram mount — a
 *  diagram rendered before a live theme switch does not retheme without remounting, the same
 *  trade-off already accepted for `RowShell`'s hover-reveal timestamp opacity. */
export function readMermaidThemeVariables(): Record<string, string> {
  const computed = getComputedStyle(document.documentElement);
  const cssVars: Record<string, string> = {};
  for (const cssVar of Object.values(MERMAID_VAR_MAP)) {
    cssVars[cssVar] = computed.getPropertyValue(cssVar);
  }
  return resolveMermaidThemeVariables(cssVars);
}
