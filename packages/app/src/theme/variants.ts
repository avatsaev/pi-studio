// Six named theme variants per design-system.md § Theme variants.
// One light + five dark tints sharing the buildDarkColors builder.

import { buildDarkColors, buildLightColors, type ThemeColors } from "./colors.js";

// theme-name → swatch color map (for Appearance picker).
export const THEME_SWATCHES: Readonly<Record<ThemeName, string>> = {
  light: "#ffffff",
  dark: "#2D8B62",
  zinc: "#808080",
  midnight: "#4A6BA8",
  claude: "#D97757",
  ghostty: "#8caaee",
};

export type ThemeName = "light" | "dark" | "zinc" | "midnight" | "claude" | "ghostty";
export const THEME_NAMES: readonly ThemeName[] = [
  "light",
  "dark",
  "zinc",
  "midnight",
  "claude",
  "ghostty",
];

function buildVariantColors(name: ThemeName): ThemeColors {
  if (name === "light") return buildLightColors();

  switch (name) {
    // Paseo — subtle teal-green tint (default). Exact values from Paseo `paseoDarkColors`.
    case "dark":
      return buildDarkColors({
        surface0: "#181B1A",
        surface1: "#1E2120",
        surface2: "#272A29",
        surface3: "#434645",
        surface4: "#595B5B",
        surfaceDiffEmpty: "#252827",
        surfaceSidebar: "#141716",
        surfaceSidebarHover: "#1c1f1e",
        mutedForeground: "#A1A5A4",
        scrollbarHandle: "#717574",
        border: "#252B2A",
        borderAccent: "#2F3534",
        accent: "#20744A",
        accentBright: "#7ccba0",
        destructive: "#c64f43",
      });

    // Zinc — neutral gray, no tint. Exact values from Paseo `zincDarkColors`.
    case "zinc":
      return buildDarkColors({
        surface0: "#18181b",
        surface1: "#1f1f22",
        surface2: "#27272a",
        surface3: "#3f3f46",
        surface4: "#52525b",
        surfaceDiffEmpty: "#242427",
        surfaceSidebar: "#131316",
        surfaceSidebarHover: "#1b1b1e",
        mutedForeground: "#a1a1aa",
        scrollbarHandle: "#71717a",
        border: "#27272a",
        borderAccent: "#303036",
        accent: "#e4e4e7",
        accentBright: "#fafafa",
        destructive: "#c44a4a",
      });

    // Midnight — subtle blue tint. Exact values from Paseo `midnightDarkColors`.
    case "midnight":
      return buildDarkColors({
        surface0: "#161820",
        surface1: "#1c1e27",
        surface2: "#252731",
        surface3: "#3c3e4c",
        surface4: "#535564",
        surfaceDiffEmpty: "#222430",
        surfaceSidebar: "#121420",
        surfaceSidebarHover: "#1a1c28",
        mutedForeground: "#9a9db0",
        scrollbarHandle: "#6b6e82",
        border: "#242636",
        borderAccent: "#2e3040",
        accent: "#3b6fcf",
        accentBright: "#7eaaeb",
        destructive: "#c44a52",
      });

    // Claude — warm neutral with subtle orange undertone. From Paseo `claudeDarkColors`.
    case "claude":
      return buildDarkColors({
        surface0: "#1f1f1e",
        surface1: "#262523",
        surface2: "#2f2d2b",
        surface3: "#4a4745",
        surface4: "#605d5b",
        surfaceDiffEmpty: "#2a2826",
        surfaceSidebar: "#1a1918",
        surfaceSidebarHover: "#222120",
        mutedForeground: "#ada9a5",
        scrollbarHandle: "#78746f",
        border: "#2c2a27",
        borderAccent: "#36332f",
        accent: "#d97757",
        accentBright: "#e89a7f",
        destructive: "#cf513e",
      });

    // Ghostty — blue-tinted dark. Exact values from Paseo `ghosttyDarkColors`.
    case "ghostty":
      return buildDarkColors({
        surface0: "#282c34",
        surface1: "#2f333d",
        surface2: "#383c48",
        surface3: "#4a4f5e",
        surface4: "#5b6175",
        surfaceDiffEmpty: "#323643",
        surfaceSidebar: "#21252d",
        surfaceSidebarHover: "#292d36",
        mutedForeground: "#c8ccd8",
        scrollbarHandle: "#a0a4b2",
        border: "#353a47",
        borderAccent: "#3f4454",
        accent: "#89b4fa",
        accentBright: "#b4d0fc",
        destructive: "#c44a55",
      });
  }
}

export type ThemeVariant = {
  name: ThemeName;
  colorScheme: "light" | "dark";
  colors: ThemeColors;
  swatch: string;
};

const _variants: Record<ThemeName, ThemeVariant> = {} as Record<ThemeName, ThemeVariant>;
for (const name of THEME_NAMES) {
  const colorScheme: "light" | "dark" = name === "light" ? "light" : "dark";
  _variants[name] = {
    name,
    colorScheme,
    colors: buildVariantColors(name),
    swatch: THEME_SWATCHES[name],
  };
}
export const THEME_VARIANTS: Readonly<Record<ThemeName, ThemeVariant>> = _variants;
