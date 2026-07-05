// Six named theme variants per design-system.md § Theme variants.
// One light + five dark tints sharing the buildDarkColors builder.

import { buildDarkColors, buildLightColors, type ThemeColors } from "./colors.js";
import { palette } from "./palette.js";

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
    case "dark":
      return buildDarkColors({
        surface0: "#1a1f1c",
        surface1: "#1f2622",
        surface2: "#252e28",
        surface3: "#2d3830",
        surface4: "#36453c",
        surfaceSidebar: "#181d1a",
        surfaceSidebarHover: "#1f2622",
        mutedForeground: "#7a9484",
        scrollbarHandle: "#3a4a40",
        border: "#2a3830",
        borderAccent: "#253028",
        accent: "#20744A",
        accentBright: "#7ccba0",
        destructive: palette.red["700"],
      });

    case "zinc":
      return buildDarkColors({
        surface0: "#18181b",
        surface1: "#1c1c1f",
        surface2: "#222226",
        surface3: "#2a2a2e",
        surface4: "#333338",
        surfaceSidebar: "#141417",
        surfaceSidebarHover: "#1c1c1f",
        mutedForeground: "#71717a",
        scrollbarHandle: "#3f3f46",
        border: "#27272a",
        borderAccent: "#222225",
        accent: "#e4e4e7",
        accentBright: "#f4f4f5",
        destructive: palette.red["600"],
      });

    case "midnight":
      return buildDarkColors({
        surface0: "#181c2a",
        surface1: "#1c2130",
        surface2: "#222840",
        surface3: "#2a3350",
        surface4: "#334060",
        surfaceSidebar: "#151928",
        surfaceSidebarHover: "#1c2130",
        mutedForeground: "#6a7fa8",
        scrollbarHandle: "#2e3f60",
        border: "#253050",
        borderAccent: "#1e2a48",
        accent: "#3b6fcf",
        accentBright: "#628de8",
        destructive: palette.red["700"],
      });

    case "claude":
      return buildDarkColors({
        surface0: "#1c1814",
        surface1: "#221e18",
        surface2: "#2a231c",
        surface3: "#342c24",
        surface4: "#3e342a",
        surfaceSidebar: "#181510",
        surfaceSidebarHover: "#221e18",
        mutedForeground: "#9b7560",
        scrollbarHandle: "#4a3a2e",
        border: "#3a2e24",
        borderAccent: "#2e241c",
        accent: "#d97757",
        accentBright: "#e89878",
        destructive: palette.red["700"],
      });

    case "ghostty":
      return buildDarkColors({
        surface0: "#1e2030",
        surface1: "#232538",
        surface2: "#292c42",
        surface3: "#30334c",
        surface4: "#393d58",
        surfaceSidebar: "#1a1c2c",
        surfaceSidebarHover: "#232538",
        mutedForeground: "#6878a8",
        scrollbarHandle: "#383c5a",
        border: "#2c3054",
        borderAccent: "#252848",
        accent: "#89b4fa",
        accentBright: "#a0c8fc",
        destructive: palette.red["600"],
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
