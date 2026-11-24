/**
 * Pi package source specs (`npm:<name>[@<version>]`, `git:<url>[@<ref>]`): the pure parsing the
 * curated-packs manifest, the sync planner, the resources service and the single binary's Pi
 * overrides share. No filesystem, no process, no daemon dependency — and no import of the server
 * version, so it loads inside the compiled binary's `__pi` entry.
 */

export interface ParsedSource {
  kind: "npm" | "git";
  /** Pi's own dedup key: npm package name, or git URL without ref. */
  identity: string;
  pinned: boolean;
}

/** Split a pi git source's `repo[@ref]` shape (mirrors pi's own `splitRef`,
 *  `@earendil-works/pi-coding-agent/dist/utils/git.js`), so `pinned` is correct for scp-like
 *  (`git@host:path@ref`), URL (`https://host/path@ref`), and bare (`host/path@ref`) forms. */
function splitGitRef(url: string): { repo: string; ref?: string } {
  const scpMatch = /^git@([^:]+):(.+)$/.exec(url);
  if (scpMatch) {
    const host = scpMatch[1] ?? "";
    const pathWithMaybeRef = scpMatch[2] ?? "";
    const at = pathWithMaybeRef.indexOf("@");
    if (at <= 0) return { repo: url };
    const repoPath = pathWithMaybeRef.slice(0, at);
    const ref = pathWithMaybeRef.slice(at + 1);
    if (!repoPath || !ref) return { repo: url };
    return { repo: `git@${host}:${repoPath}`, ref };
  }
  if (url.includes("://")) {
    try {
      const parsed = new URL(url);
      const pathWithMaybeRef = parsed.pathname.replace(/^\/+/, "");
      const at = pathWithMaybeRef.indexOf("@");
      if (at <= 0) return { repo: url };
      const repoPath = pathWithMaybeRef.slice(0, at);
      const ref = pathWithMaybeRef.slice(at + 1);
      if (!repoPath || !ref) return { repo: url };
      parsed.pathname = `/${repoPath}`;
      return { repo: parsed.toString().replace(/\/$/, ""), ref };
    } catch {
      return { repo: url };
    }
  }
  // Bare host/path form (`pi install git:github.com/user/repo[@ref]`).
  const at = url.lastIndexOf("@");
  if (at > 0) return { repo: url.slice(0, at), ref: url.slice(at + 1) };
  return { repo: url };
}

/** Parse a pi source spec (`npm:<name>[@<version>]` or `git:<url>[@<ref>]`). Throws on any other
 *  scheme — every manifest entry must be one of the two pi understands. */
export function parseSource(source: string): ParsedSource {
  if (source.startsWith("npm:")) {
    const spec = source.slice("npm:".length);
    // A scoped package's leading `@scope/` must not be mistaken for a version separator — only an
    // `@` at index > 0 introduces a version.
    const at = spec.lastIndexOf("@");
    const hasVersion = at > 0;
    const name = hasVersion ? spec.slice(0, at) : spec;
    const version = hasVersion ? spec.slice(at + 1) : undefined;
    return { kind: "npm", identity: name, pinned: Boolean(version) };
  }
  if (source.startsWith("git:")) {
    const { repo, ref } = splitGitRef(source.slice("git:".length));
    return { kind: "git", identity: repo, pinned: Boolean(ref) };
  }
  throw new Error(`unrecognized pi source spec (must start with "npm:" or "git:"): ${source}`);
}

/** `identityOf(source) === parseSource(source).identity` — pi's dedup key, ref/version stripped. */
export function identityOf(source: string): string {
  return parseSource(source).identity;
}
