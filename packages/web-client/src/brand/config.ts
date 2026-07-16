// Brand config schema + resolver.
// features/white-label-branding.md § Public Contract, § Resolution

import { z } from "zod";
import { contrastForeground, isHexColor, lighten } from "../theme/color-utils.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const AssetRefSchema = z.string().min(1, "Asset path must not be empty");

const BrandColorsSchema = z.object({
  accent: z.string().refine(isHexColor, { message: "accent must be a valid #rrggbb hex color" }),
  accentBright: z
    .string()
    .refine(isHexColor, { message: "accentBright must be a valid #rrggbb hex color" })
    .optional(),
  accentForeground: z
    .string()
    .refine(isHexColor, { message: "accentForeground must be a valid #rrggbb hex color" })
    .optional(),
  swatch: z
    .string()
    .refine(isHexColor, { message: "swatch must be a valid #rrggbb hex color" })
    .optional(),
});

const BrandAssetsSchema = z.object({
  logoLight: AssetRefSchema,
  logoDark: AssetRefSchema,
  logoMark: AssetRefSchema.optional(),
  icon: AssetRefSchema,
  splash: AssetRefSchema.optional(),
});

const BrandLinksSchema = z
  .object({
    docs: z.string().url().optional(),
    support: z.string().url().optional(),
    issues: z.string().url().optional(),
    website: z.string().url().optional(),
  })
  .optional();

const BrandLegalSchema = z
  .object({
    copyright: z.string().optional(),
    companyName: z.string().optional(),
  })
  .optional();

export const BrandConfigSchema = z.object({
  productName: z.string().min(1, "productName is required"),
  shortName: z.string().optional(),
  tagline: z.string().optional(),
  colors: BrandColorsSchema,
  assets: BrandAssetsSchema,
  links: BrandLinksSchema,
  legal: BrandLegalSchema,
});

export type BrandConfig = z.infer<typeof BrandConfigSchema>;

// ---------------------------------------------------------------------------
// Derived brand colors (fill in optional accent fields if omitted)
// ---------------------------------------------------------------------------

export type ResolvedBrandColors = Required<
  Pick<BrandConfig["colors"], "accent" | "accentBright" | "accentForeground" | "swatch">
>;

export function resolveAccentColors(colors: BrandConfig["colors"]): ResolvedBrandColors {
  const accent = colors.accent;
  const accentBright = colors.accentBright ?? lighten(accent, 0.35);
  const accentForeground = colors.accentForeground ?? contrastForeground(accent);
  const swatch = colors.swatch ?? accent;
  return { accent, accentBright, accentForeground, swatch };
}

// ---------------------------------------------------------------------------
// Default Pi-Studio brand
// ---------------------------------------------------------------------------

export const DEFAULT_BRAND: BrandConfig = {
  productName: "Pi-Studio",
  shortName: "Pi-Studio",
  tagline: "Your local-first AI coding agent",
  colors: {
    accent: "#2e5cb8",
    accentBright: "#a2b4d7",
    accentForeground: "#ffffff",
    swatch: "#3b62b0",
  },
  assets: {
    logoLight: "brand/logo-light.svg",
    logoDark: "brand/logo-dark.svg",
    logoMark: "brand/logo-mark.svg",
    icon: "brand/icon.png",
    splash: "brand/splash.png",
  },
  links: {
    docs: "https://pi-studio.dev/docs",
    issues: "https://github.com/av-pi-studio/pi-studio/issues",
    website: "https://pi-studio.dev",
  },
  legal: {
    companyName: "Pi-Studio Contributors",
  },
};

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export type BrandResolution =
  | { ok: true; brand: BrandConfig; source: "default" | "env" }
  | { ok: false; errors: string[] };

/**
 * Resolve the active brand config.
 *
 * At build time: reads PI_STUDIO_BRAND_DIR from the environment, loads and
 * validates <dir>/brand.config.json, fails fast with field-level errors.
 * When unset: returns the default Pi-Studio brand.
 *
 * In Node unit tests `rawConfig` is injected directly to skip file I/O.
 */
export function resolveBrandConfig(rawConfig?: unknown): BrandResolution {
  if (rawConfig === undefined) {
    // No injection → use built-in default.
    return { ok: true, brand: DEFAULT_BRAND, source: "default" };
  }

  const result = BrandConfigSchema.safeParse(rawConfig);
  if (!result.success) {
    const errors = result.error.errors.map(
      (e) => `${e.path.join(".")}: ${e.message}`,
    );
    return { ok: false, errors };
  }

  // Fill optional shortName default.
  const brand = result.data;
  if (!brand.shortName) brand.shortName = brand.productName;

  return { ok: true, brand, source: "env" };
}

// ---------------------------------------------------------------------------
// Runtime accessor (frozen after first resolution)
// ---------------------------------------------------------------------------

let _resolved: BrandConfig | null = null;

export function getActiveBrand(): BrandConfig {
  if (!_resolved) _resolved = DEFAULT_BRAND;
  return _resolved;
}

/** Inject a validated brand (used in tests and by the build-time bootstrap). */
export function _setActiveBrand(brand: BrandConfig): void {
  _resolved = brand;
}

export function _resetActiveBrand(): void {
  _resolved = null;
}
