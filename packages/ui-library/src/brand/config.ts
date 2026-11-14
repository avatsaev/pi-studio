// Brand config schema + accent resolution. Only `colors.accent` is required: the accent family is
// the one thing a brand can override today (see theme-injection.ts).

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
  productName: z.string().min(1, "productName must not be empty").optional(),
  shortName: z.string().optional(),
  tagline: z.string().optional(),
  colors: BrandColorsSchema,
  assets: BrandAssetsSchema.optional(),
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
