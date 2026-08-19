/**
 * Shared href/src candidate resolution — used by both classifyImageSrc and classifyFileLinkSrc.
 *
 * Handles the common steps: strip fragments/query, detect schemes, expand ~/relative paths,
 * normalize, and percent-decode. Returns a resolved local candidate (absolute, normalized,
 * percent-decoded) or null if external/unresolvable.
 */

import { normalizeCwd } from "@pi-studio-ui/features/sessions/workspace-grouping.js";
import { collapseDotSegments, resolveWorkspacePath } from "@pi-studio-ui/lib/paths.js";

/** Matches a leading `scheme:` (e.g. `http:`, `file:`, `mailto:`) — not a Windows drive letter
 *  (`C:\...`) or a bare `:` with no scheme name. Exported for `html-assets.ts` (sprint-064), which
 *  needs the identical scheme test to classify a raw HTML asset ref as external — a second copy
 *  would drift from this one exactly as `lib/paths.ts`'s doc comment warns against for path joins. */
export const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/**
 * Try to percent-decode a string using decodeURIComponent. On malformed sequences (e.g. `%E0%`),
 * return the original string unchanged rather than throwing. Exported for `html-assets.ts`
 * (sprint-064): its confinement gate must decode a raw ref before resolving/normalizing it (the
 * reverse order lets a percent-encoded traversal survive the gate — see that module's doc
 * comment), and non-throwing behavior on a malformed sequence is exactly this function's contract.
 */
export function percentDecode(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    // Malformed percent sequence; return unchanged
    return str;
  }
}

/**
 * Shared resolution step for markdown hrefs/srcs. Strips fragments/query, detects schemes,
 * expands tilde and relatives, normalizes and percent-decodes the result.
 *
 * Returns a resolved local candidate (absolute path, normalized, percent-decoded) or null
 * if the input is external (has a scheme) or unresolvable (no base for a relative path, etc).
 *
 * @param href The raw markdown href/src
 * @param base The asset base (absolute, tilde-normalized) or null
 * @param homeDir The home directory or null
 * @returns The resolved candidate or null
 */
export function resolveHrefCandidate(
  href: string,
  base: string | null,
  homeDir: string | null,
): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;

  // Strip `#fragment` and `?query` before classifying
  const stripped = trimmed.split(/[?#]/, 1)[0]!;
  if (!stripped) return null;

  // Detect explicit schemes (http:, file:, etc). If found, it's external — return null.
  const schemeMatch = SCHEME_RE.exec(stripped);
  if (schemeMatch) {
    return null; // Has a scheme; external
  }

  // Resolve the candidate: absolute, tilde-prefixed, or relative
  let candidate: string | null;
  if (stripped.startsWith("/")) {
    candidate = stripped;
  } else if (stripped === "~" || stripped.startsWith("~/")) {
    candidate = homeDir ? normalizeCwd(stripped, homeDir) : null;
  } else {
    // Relative path
    candidate = resolveWorkspacePath(stripped, base ?? "");
  }

  if (!candidate) return null;

  // Normalize (collapse ./ and ../ segments) and percent-decode
  const normalized = collapseDotSegments(candidate);
  return percentDecode(normalized);
}
