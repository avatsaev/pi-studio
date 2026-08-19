// Pure resolution logic for the build-time-only title/icon white-label override, consumed by
// `vite.config.ts` (`PI_STUDIO_BRAND_TITLE` / `PI_STUDIO_BRAND_ICON`). This is deliberately
// separate from — and much narrower than — the `BrandConfig` scaffold in `brand/config.ts`
// (product name + accent colors + logo triplet + links + legal): that schema is a straight port
// from the clean-room `white-label-branding.md` spec and has no live loader wired to it yet
// (`resolveBrandConfig`'s own comment: `getActiveBrand()` always returns `DEFAULT_BRAND`). This
// module implements only the two knobs actually requested and wired: the toolbar/document title
// and the favicon. No theme/color/logo overrides — see that spec's § Out of scope for the
// deferred rest.
//
// Kept framework/Node-free (no `node:fs`/`node:path`) so it stays importable from both
// `vite.config.ts` (Node) and this package's browser `tsconfig.json` project without pulling a
// Node-only dependency into renderer code (AGENTS.md § Invariants "No Node-only APIs").

const DEFAULT_TITLE = "Pi-Studio";

const ICON_MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export interface ResolvedBrandIcon {
  /** Verbatim `PI_STUDIO_BRAND_ICON` value — the source file's path, untouched. */
  sourcePath: string;
  /** Output file name the icon is served/emitted as, e.g. "brand-icon.svg". */
  fileName: string;
  /** MIME type for the favicon `<link>`'s `type` attribute. */
  mime: string;
}

/**
 * Resolve the toolbar/document title from `PI_STUDIO_BRAND_TITLE`. Unset or blank falls back to
 * the default "Pi-Studio" — the default distribution renders unchanged.
 */
export function resolveBrandTitle(env: Record<string, string | undefined>): string {
  const raw = env.PI_STUDIO_BRAND_TITLE?.trim();
  return raw ? raw : DEFAULT_TITLE;
}

/**
 * Resolve the favicon override from `PI_STUDIO_BRAND_ICON`. Returns `null` when unset — the
 * default `public/favicon.svg` applies unchanged. Throws on an unsupported extension: a brand
 * override error must fail the build loudly, never silently fall back to the default icon.
 */
export function resolveBrandIcon(
  env: Record<string, string | undefined>,
): ResolvedBrandIcon | null {
  const raw = env.PI_STUDIO_BRAND_ICON?.trim();
  if (!raw) return null;

  const dot = raw.lastIndexOf(".");
  const ext = dot === -1 ? "" : raw.slice(dot).toLowerCase();
  const mime = ICON_MIME_BY_EXT[ext];
  if (!mime) {
    const supported = Object.keys(ICON_MIME_BY_EXT).join(", ");
    throw new Error(
      `PI_STUDIO_BRAND_ICON: unsupported extension "${ext || "(none)"}" in "${raw}" — expected one of ${supported}`,
    );
  }

  return { sourcePath: raw, fileName: `brand-icon${ext}`, mime };
}
