import { createRequire } from "node:module";

/**
 * The curated-packs manifest — single source of truth for which Pi extensions Pi-Studio
 * recommends (swe/features/preinstalled-extensions.md § The manifest).
 *
 * Pure data plus two tiny pure helpers: no filesystem, no process, no daemon dependency. Sources
 * are deliberately **unpinned** (design tenet 3) — `pi update` skips pinned npm specs
 * (`updateConfiguredSources`: `if (!parsed.pinned)`, pi 0.84.1 `package-manager.js:840`), so a pin
 * here would permanently exclude that extension from the user's own updater. The guard test below
 * makes that invariant mechanically unbreakable.
 */

/** One curated entry: an unpinned pi source spec, the version it was added in, and an optional
 *  deprecation tombstone. */
export interface CuratedEntry {
  /** Unpinned pi spec: `npm:<name>` or `git:<url>` — no `@version`/`@ref` suffix. */
  source: string;
  /** Aligned workspace version on disk when the entry was added (docs/UI/audit only). */
  addedIn: string;
  /** Tombstone: never offered anew; existing installs are left untouched. */
  deprecated?: boolean;
}

export interface CuratedPack {
  title: string;
  description: string;
  packages: CuratedEntry[];
}

export type CuratedPackCatalog = Record<string, CuratedPack>;

// core is implicit and always selected; swe/science/data are future audience packs, added as pure
// data edits over time.
export const CURATED_PACKS = {
  core: {
    title: "Baseline",
    description: "Recommended for everyone",
    packages: [
      // Background commands + attachable PTY/TUI sessions — long-running work without blocking a turn.
      { source: "npm:@99percentpeople/pi-background-tasks", addedIn: "0.0.73" },
      // Todo list for the model, rendered as a live overlay that survives /reload.
      { source: "npm:@juicesharp/rpiv-todo", addedIn: "0.0.73" },
      // Web search, URL fetch, repo cloning, PDF/YouTube extraction.
      { source: "npm:pi-web-access", addedIn: "0.0.73" },
      // Powerline-style status bar.
      { source: "npm:pi-powerline-footer", addedIn: "0.0.73" },
    ],
  },
} satisfies CuratedPackCatalog;

// Aligned workspace version, read from packages/server/package.json (never the root one — the
// root package.json deliberately carries no "version" field). This module sits two levels below
// the package root in both `src/` and compiled `dist/`, so the specifier is "../../package.json".
export const SERVER_VERSION: string = createRequire(import.meta.url)("../../package.json")
  .version as string;

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

/** `core` + the given slugs (deduped, order-stable, `core` always first), with unknown slugs
 *  reported for a caller-side `warn` rather than thrown. Entries are deduped by identity so a
 *  hypothetical identity reachable via two selected packs is never offered twice. */
export function selectEntries(
  catalog: CuratedPackCatalog,
  packs: readonly string[],
): { entries: { pack: string; entry: CuratedEntry }[]; unknownSlugs: string[] } {
  const slugs = ["core", ...new Set(packs.filter((slug) => slug !== "core"))];
  const entries: { pack: string; entry: CuratedEntry }[] = [];
  const unknownSlugs: string[] = [];
  const seenIdentities = new Set<string>();

  for (const slug of slugs) {
    const pack = catalog[slug];
    if (!pack) {
      if (slug !== "core") unknownSlugs.push(slug);
      continue;
    }
    for (const entry of pack.packages) {
      const identity = identityOf(entry.source);
      if (seenIdentities.has(identity)) continue;
      seenIdentities.add(identity);
      entries.push({ pack: slug, entry });
    }
  }
  return { entries, unknownSlugs };
}

// ---------------------------------------------------------------------------
// Manifest invariants (curated-packs.test.ts is the guard test that enforces these)
// ---------------------------------------------------------------------------

/** `"1.2.3"`-shaped, no pre-release/build metadata — the only form the manifest ever needs. */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/** `a <= b` for two `SEMVER_PATTERN`-shaped strings, compared numerically per segment. */
function semverLte(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db;
  }
  return true;
}

const PLACEHOLDER_PATTERN = /<(ref|version|pkg)>/;

export interface CatalogViolation {
  pack: string;
  source?: string;
  message: string;
}

/** The manifest invariants from § The manifest: every source parses and is unpinned, no identity
 *  is shared across packs, pack keys are stable slugs with `core` present, every `addedIn` is
 *  valid semver `<=` `currentVersion`, and no source carries a placeholder. Returns every
 *  violation found (empty = a clean catalog) rather than throwing on the first one, so a guard
 *  test can assert the full violation set against a deliberately broken fixture. */
export function checkCatalogInvariants(
  catalog: CuratedPackCatalog,
  currentVersion: string = SERVER_VERSION,
): CatalogViolation[] {
  const violations: CatalogViolation[] = [];
  const identityOwner = new Map<string, string>();

  if (!("core" in catalog)) {
    violations.push({ pack: "core", message: "manifest must define a 'core' pack" });
  }

  for (const [packKey, pack] of Object.entries(catalog)) {
    if (!/^[a-z][a-z0-9]*$/.test(packKey)) {
      violations.push({ pack: packKey, message: `pack key "${packKey}" is not a stable slug` });
    }

    for (const entry of pack.packages) {
      if (PLACEHOLDER_PATTERN.test(entry.source)) {
        violations.push({
          pack: packKey,
          source: entry.source,
          message: "source contains a placeholder (<ref>/<version>/<pkg>)",
        });
        continue;
      }

      let parsed: ParsedSource;
      try {
        parsed = parseSource(entry.source);
      } catch (error) {
        violations.push({
          pack: packKey,
          source: entry.source,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      if (parsed.pinned) {
        violations.push({
          pack: packKey,
          source: entry.source,
          message: "source carries a version/ref pin — sources must stay unpinned",
        });
      }

      const owner = identityOwner.get(parsed.identity);
      if (owner && owner !== packKey) {
        violations.push({
          pack: packKey,
          source: entry.source,
          message: `identity "${parsed.identity}" also appears in pack "${owner}" (identities must be disjoint across packs)`,
        });
      } else if (!owner) {
        identityOwner.set(parsed.identity, packKey);
      }

      if (!SEMVER_PATTERN.test(entry.addedIn)) {
        violations.push({
          pack: packKey,
          source: entry.source,
          message: `addedIn "${entry.addedIn}" is not valid semver`,
        });
      } else if (!semverLte(entry.addedIn, currentVersion)) {
        violations.push({
          pack: packKey,
          source: entry.source,
          message: `addedIn "${entry.addedIn}" is newer than the current version "${currentVersion}"`,
        });
      }
    }
  }

  return violations;
}
