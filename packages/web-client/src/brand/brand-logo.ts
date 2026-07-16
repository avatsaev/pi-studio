// BrandLogo variant resolution logic.
// ui-components.md § Icons (BrandLogo)
// features/white-label-branding.md § Consumers

import type { BrandConfig } from "./config.js";

export type BrandLogoVariant = "auto" | "light" | "dark" | "mark";

/**
 * Resolve the asset path for a `<BrandLogo>` given the variant and the active
 * color scheme.
 *
 * - "auto"  → logoLight when colorScheme="light", logoDark when "dark".
 * - "light" → logoLight.
 * - "dark"  → logoDark.
 * - "mark"  → logoMark if present, else falls back to the auto variant.
 */
export function resolveBrandLogoAsset(
  brand: BrandConfig,
  variant: BrandLogoVariant,
  colorScheme: "light" | "dark",
): string {
  switch (variant) {
    case "light":
      return brand.assets.logoLight;
    case "dark":
      return brand.assets.logoDark;
    case "mark":
      if (brand.assets.logoMark) return brand.assets.logoMark;
      // Fall back to wordmark for the active color scheme.
      return colorScheme === "light" ? brand.assets.logoLight : brand.assets.logoDark;
    case "auto":
      return colorScheme === "light" ? brand.assets.logoLight : brand.assets.logoDark;
  }
}
