/**
 * Markdown image source classification (features/inline-image-rendering.md § Public Contract →
 * Markdown image source classification, § Asset base). The single gate every `![](src)` in a
 * rendered chat message passes through before any network request is even considered — deciding
 * remote (render directly), local (fetch via the daemon's file-transfer path, task-003), or
 * unresolvable (render as plain fallback text, never attempt a request).
 *
 * Pure: no store/hook/network imports, so this file needs no React or client mocks to test.
 */

import { detectViewerKind } from "@pi-studio-ui/features/files/viewer-registry.js";
import { normalizeCwd } from "@pi-studio-ui/features/sessions/workspace-grouping.js";
import { resolveWorkspacePath } from "@pi-studio-ui/lib/paths.js";

export type ImageSrcClassification =
  | { kind: "remote" }
  | { kind: "local"; path: string }
  | { kind: "unresolvable" };

const REMOTE_SCHEMES = new Set(["http:", "https:", "data:", "blob:"]);

/** Matches a leading `scheme:` (e.g. `http:`, `file:`, `mailto:`) — not a Windows drive letter
 *  (`C:\...`) or a bare `:` with no scheme name. */
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/**
 * Classifies a markdown image `src`. `base` is the asset base (absolute, tilde-normalized) or
 * `null` when unknown; `homeDir` may be `null` when the daemon's home directory hasn't been
 * learned yet. Order matters — this mirrors the scope's classification table exactly:
 *
 * 1. empty/whitespace → unresolvable
 * 2. `http:`/`https:`/`data:`/`blob:` → remote
 * 3. any other `scheme:` prefix (including `file:`) → unresolvable
 * 4. `/…` → candidate local path as-is
 * 5. `~`/`~/…` → expand against `homeDir` (unknown home dir → unresolvable)
 * 6. `./…`, `../…`, bare relative → resolve against `base` (no base → unresolvable)
 * 7. final gate: the candidate must be an image per `detectViewerKind`, else unresolvable
 */
export function classifyImageSrc(
  src: string,
  base: string | null,
  homeDir: string | null,
): ImageSrcClassification {
  const trimmed = src.trim();
  if (!trimmed) return { kind: "unresolvable" };

  // Markdown may carry a title/version via `#fragment`/`?query`; strip both before classifying so
  // a trailing `?` never defeats the extension gate below.
  const stripped = trimmed.split(/[?#]/, 1)[0]!;
  if (!stripped) return { kind: "unresolvable" };

  const schemeMatch = SCHEME_RE.exec(stripped);
  if (schemeMatch) {
    const scheme = `${schemeMatch[1]!.toLowerCase()}:`;
    return REMOTE_SCHEMES.has(scheme) ? { kind: "remote" } : { kind: "unresolvable" };
  }

  let candidate: string | null;
  if (stripped.startsWith("/")) {
    candidate = stripped;
  } else if (stripped === "~" || stripped.startsWith("~/")) {
    candidate = homeDir ? normalizeCwd(stripped, homeDir) : null;
  } else {
    candidate = resolveWorkspacePath(stripped, base ?? "");
  }

  if (!candidate) return { kind: "unresolvable" };
  if (detectViewerKind(candidate) !== "image") return { kind: "unresolvable" };
  return { kind: "local", path: candidate };
}
