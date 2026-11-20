/**
 * Splits what `classifyFileLinkSrc` calls `external` in two: an in-page reference (empty or
 * fragment-only, left to the browser) and a URL with a scheme (routed through the host).
 * Pure: no React or store imports.
 */

export type ExternalHrefKind = "in-page" | "url";

export function classifyExternalHref(href: string): ExternalHrefKind {
  const trimmed = href.trim();
  return trimmed === "" || trimmed.startsWith("#") ? "in-page" : "url";
}
