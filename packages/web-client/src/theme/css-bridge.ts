/**
 * Theme → CSS custom properties bridge.
 * Flattens a Theme object into `--pi-*` CSS variables on :root.
 * design-system.md § Purpose (render-stack decision)
 */

import { type Theme } from "./theme.js";
import { type ThemeColors, type SyntaxColors, type TerminalTheme } from "./colors.js";

// ---------------------------------------------------------------------------
// Token → variable-name map
// ---------------------------------------------------------------------------

/**
 * Given a Theme, produces a flat Record<`--pi-${path}`, value> map
 * suitable for setting on `document.documentElement.style`.
 */
export function flattenThemeToVars(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};

  // Colors (flat semantic tokens)
  flattenColors(theme.colors, vars);

  // Spacing
  for (const [key, val] of Object.entries(theme.spacing)) {
    vars[`--pi-spacing-${key}`] = `${val}px`;
  }

  // Font size
  for (const [key, val] of Object.entries(theme.fontSize)) {
    vars[`--pi-font-size-${key}`] = `${val}px`;
  }

  // Font family
  vars["--pi-font-ui"] = theme.fontFamily.ui;
  vars["--pi-font-mono"] = theme.fontFamily.mono;

  // Line height
  vars["--pi-line-height-diff"] = `${theme.lineHeight.diff}px`;

  // Icon size
  for (const [key, val] of Object.entries(theme.iconSize)) {
    vars[`--pi-icon-size-${key}`] = `${val}px`;
  }

  // Font weight
  for (const [key, val] of Object.entries(theme.fontWeight)) {
    vars[`--pi-font-weight-${key}`] = String(val);
  }

  // Border radius
  for (const [key, val] of Object.entries(theme.borderRadius)) {
    vars[`--pi-radius-${key}`] = val === 9999 ? "9999px" : `${val}px`;
  }

  // Border width
  for (const [key, val] of Object.entries(theme.borderWidth)) {
    vars[`--pi-border-width-${key}`] = `${val}px`;
  }

  // Opacity
  for (const [key, val] of Object.entries(theme.opacity)) {
    vars[`--pi-opacity-${key}`] = String(val);
  }

  // Shadow (convert { offsetX, offsetY, radius, color } → CSS box-shadow string)
  for (const [key, val] of Object.entries(theme.shadow)) {
    if (typeof val === "string") {
      vars[`--pi-shadow-${key}`] = val;
    } else if (val && typeof val === "object") {
      const s = val as { offsetX: number; offsetY: number; radius: number; color: string };
      vars[`--pi-shadow-${key}`] = `${s.offsetX}px ${s.offsetY}px ${s.radius}px ${s.color}`;
    }
  }

  // Color scheme marker (for prefers-color-scheme media query override)
  vars["--pi-color-scheme"] = theme.colorScheme;

  return vars;
}

function flattenColors(colors: ThemeColors, vars: Record<string, string>): void {
  // Top-level semantic color tokens
  const {
    palette: _palette,
    syntax: _syntax,
    terminal: _terminal,
    ...semanticColors
  } = colors;

  // Emit color tokens VERBATIM (camelCase), e.g. `--pi-color-surfaceSidebar`,
  // `--pi-color-foregroundMuted`, `--pi-color-statusDanger`. This matches how
  // every component references them; kebab-casing here silently broke all
  // multi-word tokens (they fell back to defaults).
  for (const [key, val] of Object.entries(semanticColors)) {
    if (typeof val === "string") {
      vars[`--pi-color-${key}`] = val;
    }
  }

  // Syntax colors → --syntax-*
  if (_syntax) {
    flattenSyntax(_syntax, vars);
  }

  // Terminal colors are not CSS variables (consumed by xterm config directly);
  // but we expose a few key ones for CSS terminal-wrapper styling.
  if (_terminal) {
    vars["--pi-terminal-bg"] = _terminal.background;
    vars["--pi-terminal-fg"] = _terminal.foreground;
  }
}

function flattenSyntax(syntax: SyntaxColors, vars: Record<string, string>): void {
  for (const [key, val] of Object.entries(syntax)) {
    if (typeof val === "string") {
      vars[`--syntax-${camelToKebab(key)}`] = val;
    }
  }
}

/** Convert camelCase to kebab-case. */
function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

// ---------------------------------------------------------------------------
// DOM application
// ---------------------------------------------------------------------------

/**
 * Apply a flattened variable map to the document root.
 * Idempotent — re-applying the same map is a no-op (DOM diffing).
 */
export function applyVarsToRoot(vars: Record<string, string>): void {
  if (typeof document === "undefined") return;
  const style = document.documentElement.style;
  for (const [prop, val] of Object.entries(vars)) {
    style.setProperty(prop, val);
  }
  // Set color-scheme for native form control theming
  const scheme = vars["--pi-color-scheme"];
  if (scheme) {
    document.documentElement.style.setProperty("color-scheme", scheme);
  }
}

/**
 * Full pipeline: flatten a Theme and apply to the DOM.
 */
export function applyThemeToDOM(theme: Theme): void {
  const vars = flattenThemeToVars(theme);
  applyVarsToRoot(vars);
}
