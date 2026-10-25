// Pure, zero-dependency classifier for a skill install source string
// (swe/architecture/pi-resource-management.md § Source kinds). Shared between the web client
// (live label while the user types a source) and the daemon (`source-detect.ts` re-export per
// the architecture doc's component table) — the **daemon's** classification is always
// authoritative; a client-sent `kind` on the wire is ignored (`skills_preview_request` /
// `skills_install_request` carry only `source`, never `kind`).
//
// No filesystem access here: `local_path` is detected purely syntactically (absolute or
// `~`-prefixed); whether the directory actually exists on the daemon host is checked server-side.

/** One of the four installable source kinds the daemon recognizes; `null` from
 * `detectSkillSource` means "anything else" (`invalid_source` once the server rejects it). */
export type SkillSourceKind = "pi_npm" | "pi_git" | "skills_repo" | "local_path";

export interface DetectedSkillSource {
  kind: SkillSourceKind;
  /** Whitespace-trimmed input, unchanged otherwise. Further parsing (e.g. splitting a
   * `/tree/<ref>/<path>` subpath out of a `skills_repo` URL, or expanding a `~` in a
   * `local_path`) is each consumer's own job — this classifier never reaches into the
   * filesystem or re-derives host state. */
  normalized: string;
}

const NPM_SOURCE_RE = /^npm:\S+$/;
const GIT_PREFIX_SOURCE_RE = /^git:\S+$/;
const SSH_URL_RE = /^ssh:\/\/\S+$/;
/** `git@host:owner/repo[.git]` scp-like syntax. */
const SCP_LIKE_RE = /^git@[^\s:/]+:\S+$/;
/** `http(s)://[www.]<github|gitlab>.com/<anything>` — covers plain repo URLs and
 * `/tree/<ref>/<path>` subpaths alike; the subpath is opaque here. */
const GIT_HOST_URL_RE = /^https?:\/\/(?:[^\s/]*\.)?(?:github|gitlab)\.com\/\S+$/i;
/** Any scheme'd URL ending in `.git` (self-hosted Git forges, bare `git://`, etc). */
const GIT_SUFFIX_URL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+\.git$/;
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
/** GitHub/GitLab slug segment: alnum, `.`/`_`/`-` in the middle, never a leading/trailing one. */
const OWNER_REPO_SEGMENT = "[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?";
/** `owner/repo` or `owner/repo@skill` — exactly one slash, so a deeper or `./`/`../`-prefixed
 * relative path never matches (those fall through to `null`). */
const OWNER_REPO_RE = new RegExp(
  `^${OWNER_REPO_SEGMENT}/${OWNER_REPO_SEGMENT}(?:@${OWNER_REPO_SEGMENT})?$`,
);

/**
 * Classify a skill install source string. Returns `null` for anything that isn't one of the four
 * recognized kinds (relative paths, bare words, non-git `http(s)` file URLs, empty input) — the
 * caller renders that as "Unrecognized" / the daemon answers `invalid_source`.
 */
export function detectSkillSource(input: string): DetectedSkillSource | null {
  const normalized = input.trim();
  if (normalized.length === 0) {
    return null;
  }

  if (NPM_SOURCE_RE.test(normalized)) {
    return { kind: "pi_npm", normalized };
  }
  if (GIT_PREFIX_SOURCE_RE.test(normalized)) {
    return { kind: "pi_git", normalized };
  }
  if (normalized === "~" || normalized.startsWith("~/") || normalized.startsWith("/")) {
    return { kind: "local_path", normalized };
  }
  if (
    SCP_LIKE_RE.test(normalized) ||
    SSH_URL_RE.test(normalized) ||
    GIT_HOST_URL_RE.test(normalized) ||
    GIT_SUFFIX_URL_RE.test(normalized)
  ) {
    return { kind: "skills_repo", normalized };
  }
  if (URL_SCHEME_RE.test(normalized)) {
    // Has a URL scheme but isn't a recognized git host or `*.git` suffix — e.g. a plain file
    // link. Explicitly not installable, never falls through to the owner/repo check below.
    return null;
  }
  if (OWNER_REPO_RE.test(normalized)) {
    return { kind: "skills_repo", normalized };
  }
  return null;
}
