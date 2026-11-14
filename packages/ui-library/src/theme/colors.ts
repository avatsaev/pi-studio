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
  // A fixed, vivid, theme-invariant blue for "informational" signals that need to stay legible
  // regardless of the variant's own accent tint (e.g. shell/read/search/fetch tool-kind badges) —
  // same rationale as statusSuccess/statusWarning: `accent` varies wildly across variants (a dark
  // muted navy on `dark`, a near-white gray on `zinc`), so a badge that needs to always read
  // clearly can't be built on it.
  statusInfo: string;
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

// Signal status colors — semantic success/danger/warning/merged. Kept a step
// darker than the raw palette so they read as signals, not neon. Per Paseo
// (`~/DEV/paseo/packages/app/src/styles/theme.ts`) light and dark differ.
const DARK_STATUS = {
  statusSuccess: "#16a34a", // green-600
  statusDanger: "#dc2626", // red-600
  statusWarning: "#f59e0b", // amber-500
  statusMerged: "#9333ea", // purple-600
  statusInfo: "#3b82f6", // blue-500
} as const;
const LIGHT_STATUS = {
  statusSuccess: "#15803d", // green-700
  statusDanger: "#b91c1c", // red-700
  statusWarning: "#d97706", // amber-600
  statusMerged: "#7c3aed", // purple-600
  statusInfo: "#2563eb", // blue-600
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
  surfaceDiffEmpty: string;
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
  // Paseo dark foreground is zinc-50 (#fafafa), not zinc-100.
  const foreground = palette.zinc["50"];
  const accentForeground = contrastForeground(tint.accent);
  return {
    surface0: tint.surface0,
    surface1: tint.surface1,
    surface2: tint.surface2,
    surface3: tint.surface3,
    surface4: tint.surface4,
    surfaceDiffEmpty: tint.surfaceDiffEmpty,
    surfaceSidebar: tint.surfaceSidebar,
    surfaceSidebarHover: tint.surfaceSidebarHover,
    // Paseo dark: the workspace surface is surface1 (not the app background surface0).
    surfaceWorkspace: tint.surface1,
    foreground,
    foregroundMuted: tint.mutedForeground,
    accent: tint.accent,
    accentBright: tint.accentBright,
    accentForeground,
    destructive: tint.destructive,
    destructiveForeground: palette.white,
    // Paseo: success uses the theme accent in dark.
    success: tint.accent,
    successForeground: palette.white,
    border: tint.border,
    borderAccent: tint.borderAccent,
    ...DARK_STATUS,
    diffAddition: palette.green["400"], // #4ade80
    diffDeletion: palette.red["500"], // #ef4444
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
// Values mirror Paseo's `lightSemanticColors` (`~/DEV/paseo/.../styles/theme.ts`).
export function buildLightColors(): ThemeColors {
  const foreground = "#1a1a1e";
  const accent = "#253e6f";
  return {
    surface0: "#ffffff",
    surface1: "#fafafa",
    surface2: "#f4f4f5",
    surface3: "#e4e4e7",
    surface4: "#d4d4d8",
    surfaceDiffEmpty: "#f6f6f6",
    surfaceSidebar: "#f4f4f5",
    surfaceSidebarHover: "#e9e9ec",
    surfaceWorkspace: "#ffffff",
    foreground,
    foregroundMuted: "#71717a",
    accent,
    accentBright: "#2f4f8e",
    accentForeground: contrastForeground(accent),
    destructive: "#b04138",
    destructiveForeground: "#ffffff",
    success: accent,
    successForeground: "#ffffff",
    border: "#e4e4e7",
    borderAccent: "#ececf1",
    ...LIGHT_STATUS,
    diffAddition: "#15803d", // green-700
    diffDeletion: "#b91c1c", // red-700
    scrollbarHandle: "#3f3f46", // zinc-700
    background: "#ffffff",
    popover: "#ffffff",
    popoverForeground: foreground,
    primary: accent,
    secondary: "#f4f4f5",
    muted: "#f4f4f5",
    mutedForeground: "#71717a",
    input: "#f4f4f5",
    ring: accent,
    palette,
    syntax: lightSyntax(),
    terminal: {
      ...terminalFrom("#ffffff", foreground, accent),
      selectionBackground: "rgba(0,0,0,0.15)",
      white: "#ffffff",
      brightWhite: "#fafafa",
    },
  };
}

export { lighten };
