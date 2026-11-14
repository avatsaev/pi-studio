/**
 * Markdown file link source classification (features/file-link-rendering.md § Public Contract →
 * Markdown link source classification). Decides whether a markdown link `[label](href)` should
 * open a local file (intercepted by the client) or navigate as a regular link.
 *
 * Two-way classification simpler than the image classifier's three-way one:
 * - `local`: resolves to a local filesystem path → intercept, open as a file
 * - `external`: anything else → pass through as a regular navigating anchor
 *
 * Pure: no store/hook/network imports, so this file needs no React or client mocks to test.
 */

import { resolveHrefCandidate } from "./href-resolution.js";

export type FileLinkClassification = { kind: "local"; path: string } | { kind: "external" };

/**
 * Classifies a markdown link `href`. `base` is the asset base (absolute, tilde-normalized) or
 * `null` when unknown; `homeDir` may be `null` when the daemon's home directory hasn't been
 * learned yet. Order matters — this mirrors the scope's classification table exactly:
 *
 * 1. empty/whitespace → external
 * 2. fragment-only (`#section`) → external (in-page anchor must not be intercepted)
 * 3. path+fragment (`README.md#usage`) → fragment stripped by resolver, remainder classifies
 * 4. `http:`/`https:` scheme → external
 * 5. any other `scheme:` prefix (incl. `file:`) → external
 * 6. `/…` → local, path used as-is
 * 7. `~`/`~/…` → local, `~` expanded (unknown home dir → external)
 * 8. `./…`, `../…`, bare relative → local, joined against `base` (no base → external)
 * 9. No extension gate (unlike images) — any resolved local path qualifies, including directories
 */
export function classifyFileLinkSrc(
  href: string,
  base: string | null,
  homeDir: string | null,
): FileLinkClassification {
  const trimmed = href.trim();
  if (!trimmed) return { kind: "external" };

  // Fragment-only check: if the href contains only `#`, it's an in-page anchor
  if (trimmed.startsWith("#")) return { kind: "external" };

  // Use the shared resolution step: strips fragments/query, resolves paths, normalizes + decodes
  const candidate = resolveHrefCandidate(href, base, homeDir);

  // If resolved successfully, it's a local file link; otherwise external
  if (candidate) {
    return { kind: "local", path: candidate };
  }
  return { kind: "external" };
}
