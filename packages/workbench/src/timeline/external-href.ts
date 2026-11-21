/**
 * Splits what `classifyFileLinkSrc` calls `external` in three: no target (an empty href — the
 * markdown renderer blanks `javascript:`, `file:` and other unsafe URLs to `""`; an anchor with
 * it would reload the app), an in-page reference (fragment-only, left to the browser) and a URL
 * with a scheme (routed through the host). Pure: no React or store imports.
 */

export type ExternalHrefKind = "none" | "in-page" | "url";

export function classifyExternalHref(href: string): ExternalHrefKind {
  const trimmed = href.trim();
  if (trimmed === "") return "none";
  return trimmed.startsWith("#") ? "in-page" : "url";
}
