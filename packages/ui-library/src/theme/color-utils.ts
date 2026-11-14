// Small pure color helpers used by the theme builder and (later) brand accent derivation.
// No external deps; operates on `#rrggbb` / `#rgb` hex strings.

export type Rgb = { r: number; g: number; b: number };

export function hexToRgb(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  if (full.length !== 6 || /[^0-9a-fA-F]/.test(full)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (n: number) => clamp255(n).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

// Relative luminance per WCAG (0 = black, 1 = white).
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// Contrast-safe text color to place ON TOP of `hex`.
export function contrastForeground(hex: string, dark = "#18181b", light = "#ffffff"): string {
  return relativeLuminance(hex) > 0.45 ? dark : light;
}

// Mix `hex` toward white by `amount` (0..1). Used to derive an accentBright when omitted.
export function lighten(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.max(0, Math.min(1, amount));
  return rgbToHex({
    r: r + (255 - r) * a,
    g: g + (255 - g) * a,
    b: b + (255 - b) * a,
  });
}

// Mix `hex` toward black by `amount` (0..1).
export function darken(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.max(0, Math.min(1, amount));
  return rgbToHex({ r: r * (1 - a), g: g * (1 - a), b: b * (1 - a) });
}

export function isHexColor(value: string): boolean {
  const h = value.trim().replace(/^#/, "");
  return (h.length === 3 || h.length === 6) && !/[^0-9a-fA-F]/.test(h);
}
