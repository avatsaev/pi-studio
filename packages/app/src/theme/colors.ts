// Layer-based semantic color system + syntax/terminal maps per design-system.md § Colors.

import { contrastForeground, lighten } from "./color-utils.js";
import { palette } from "./palette.js";

// Highlight token → color map (see timeline-rendering.md § Syntax highlighting).
export type SyntaxColors = {
  keyword: string;
  string: string;
  number: string;
  boolean: string;
  comment: string;
  function: string;
  variable: string;
  type: string;
  class: string;
  constant: string;
  operator: string;
  punctuation: string;
  tag: string;
  attribute: string;
  property: string;
  regexp: string;
  escape: string;
  heading: string;
  link: string;
  deleted: string;
  inserted: string;
};

// Full xterm theme: bg/fg/cursor/selection + 16 ANSI colors.
export type TerminalTheme = {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
};

export type ThemeColors = {
  // Surfaces (elevation ramp)
  surface0: string;
  surface1: string;
  surface2: string;
  surface3: string;
  surface4: string;
  // Surfaces (special)
  surfaceDiffEmpty: string;
  surfaceSidebar: string;
  surfaceSidebarHover: string;
  surfaceWorkspace: string;
  // Text
  foreground: string;
  foregroundMuted: string;
  // Brand
  accent: string;
  accentBright: string;
  accentForeground: string;
  // Semantic
  destructive: string;
  destructiveForeground: string;
  success: string;
  successForeground: string;
  // Borders
  border: string;
  borderAccent: string;
  // Status
  statusSuccess: string;
  statusDanger: string;
  statusWarning: string;
  statusMerged: string;
  // Diff
  diffAddition: string;
  diffDeletion: string;
  // Controls
  scrollbarHandle: string;
  // Legacy aliases (migration only; new code uses semantic tokens above)
  background: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  secondary: string;
  muted: string;
  mutedForeground: string;
  input: string;
  ring: string;
  // Nested raw scales
  palette: typeof palette;
  syntax: SyntaxColors;
  terminal: TerminalTheme;
};

// Signal status colors — "a step darker than raw palette" per the doc.
const STATUS = {
  success: palette.green["700"],
  danger: palette.red["700"],
  warning: palette.amber["700"],
  merged: palette.purple["600"],
} as const;

function darkSyntax(): SyntaxColors {
  return {
    keyword: palette.purple["300"],
    string: palette.green["300"],
    number: palette.orange["300"],
    boolean: palette.orange["300"],
    comment: palette.zinc["500"],
    function: palette.blue["300"],
    variable: palette.zinc["200"],
    type: palette.teal["300"],
    class: palette.amber["300"],
    constant: palette.orange["300"],
    operator: palette.zinc["400"],
    punctuation: palette.zinc["400"],
    tag: palette.red["300"],
    attribute: palette.amber["300"],
    property: palette.blue["200"],
    regexp: palette.teal["300"],
    escape: palette.orange["200"],
    heading: palette.blue["300"],
    link: palette.blue["400"],
    deleted: palette.red["400"],
    inserted: palette.green["400"],
  };
}

function lightSyntax(): SyntaxColors {
  return {
    keyword: palette.purple["700"],
    string: palette.green["700"],
    number: palette.orange["700"],
    boolean: palette.orange["700"],
    comment: palette.zinc["500"],
    function: palette.blue["700"],
    variable: palette.zinc["800"],
    type: palette.teal["700"],
    class: palette.amber["700"],
    constant: palette.orange["700"],
    operator: palette.zinc["600"],
    punctuation: palette.zinc["600"],
    tag: palette.red["700"],
    attribute: palette.amber["700"],
    property: palette.blue["700"],
    regexp: palette.teal["700"],
    escape: palette.orange["700"],
    heading: palette.blue["700"],
    link: palette.blue["600"],
    deleted: palette.red["700"],
    inserted: palette.green["700"],
  };
}

// Tint config consumed by the dark-theme builder.
export type DarkTintConfig = {
  surface0: string;
  surface1: string;
  surface2: string;
  surface3: string;
  surface4: string;
  surfaceSidebar: string;
  surfaceSidebarHover: string;
  mutedForeground: string;
  scrollbarHandle: string;
  border: string;
  borderAccent: string;
  accent: string;
  accentBright: string;
  destructive: string;
};

function terminalFrom(surface0: string, foreground: string, accent: string): TerminalTheme {
  return {
    background: surface0,
    foreground,
    cursor: accent,
    cursorAccent: surface0,
    selectionBackground: "rgba(255,255,255,0.18)",
    black: palette.zinc["900"],
    red: palette.red["500"],
    green: palette.green["500"],
    yellow: palette.amber["500"],
    blue: palette.blue["500"],
    magenta: palette.purple["500"],
    cyan: palette.teal["500"],
    white: palette.zinc["300"],
    brightBlack: palette.zinc["600"],
    brightRed: palette.red["400"],
    brightGreen: palette.green["400"],
    brightYellow: palette.amber["400"],
    brightBlue: palette.blue["400"],
    brightMagenta: palette.purple["400"],
    brightCyan: palette.teal["400"],
    brightWhite: palette.zinc["50"],
  };
}

// Build a full dark theme color set from a tint config.
export function buildDarkColors(tint: DarkTintConfig): ThemeColors {
  const foreground = palette.zinc["100"];
  const accentForeground = contrastForeground(tint.accent);
  return {
    surface0: tint.surface0,
    surface1: tint.surface1,
    surface2: tint.surface2,
    surface3: tint.surface3,
    surface4: tint.surface4,
    surfaceDiffEmpty: tint.surface1,
    surfaceSidebar: tint.surfaceSidebar,
    surfaceSidebarHover: tint.surfaceSidebarHover,
    surfaceWorkspace: tint.surface0,
    foreground,
    foregroundMuted: tint.mutedForeground,
    accent: tint.accent,
    accentBright: tint.accentBright,
    accentForeground,
    destructive: tint.destructive,
    destructiveForeground: palette.white,
    success: palette.green["500"],
    successForeground: palette.white,
    border: tint.border,
    borderAccent: tint.borderAccent,
    statusSuccess: STATUS.success,
    statusDanger: STATUS.danger,
    statusWarning: STATUS.warning,
    statusMerged: STATUS.merged,
    diffAddition: palette.green["400"],
    diffDeletion: palette.red["400"],
    scrollbarHandle: tint.scrollbarHandle,
    // Legacy aliases → nearest semantic token
    background: tint.surface0,
    popover: tint.surface2,
    popoverForeground: foreground,
    primary: tint.accent,
    secondary: tint.surface2,
    muted: tint.surface2,
    mutedForeground: tint.mutedForeground,
    input: tint.surface2,
    ring: tint.accent,
    palette,
    syntax: darkSyntax(),
    terminal: terminalFrom(tint.surface0, foreground, tint.accent),
  };
}

// The single light theme (built directly, not via the dark builder).
export function buildLightColors(): ThemeColors {
  const foreground = palette.zinc["900"];
  const accent = "#20744A";
  return {
    surface0: palette.white,
    surface1: palette.zinc["50"],
    surface2: palette.zinc["100"],
    surface3: palette.zinc["200"],
    surface4: palette.zinc["300"],
    surfaceDiffEmpty: palette.zinc["50"],
    surfaceSidebar: palette.zinc["100"],
    surfaceSidebarHover: palette.zinc["200"],
    surfaceWorkspace: palette.white,
    foreground,
    foregroundMuted: palette.zinc["600"],
    accent,
    accentBright: "#2D8B62",
    accentForeground: palette.white,
    destructive: palette.red["600"],
    destructiveForeground: palette.white,
    success: palette.green["600"],
    successForeground: palette.white,
    border: palette.zinc["200"],
    borderAccent: palette.zinc["100"],
    statusSuccess: STATUS.success,
    statusDanger: STATUS.danger,
    statusWarning: STATUS.warning,
    statusMerged: STATUS.merged,
    diffAddition: palette.green["700"],
    diffDeletion: palette.red["700"],
    scrollbarHandle: palette.zinc["300"],
    background: palette.white,
    popover: palette.white,
    popoverForeground: foreground,
    primary: accent,
    secondary: palette.zinc["100"],
    muted: palette.zinc["100"],
    mutedForeground: palette.zinc["600"],
    input: palette.zinc["100"],
    ring: accent,
    palette,
    syntax: lightSyntax(),
    terminal: {
      ...terminalFrom(palette.white, foreground, accent),
      selectionBackground: "rgba(24,24,27,0.15)",
      white: palette.zinc["700"],
      brightWhite: palette.zinc["900"],
    },
  };
}

export { lighten };
