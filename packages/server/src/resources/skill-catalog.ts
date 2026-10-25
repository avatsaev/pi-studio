import { existsSync } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, dirname, resolve as resolvePathAbs } from "node:path";

import { CURATED_PACKS, parseSource as parseCuratedSource } from "../extensions/curated-packs.js";
import { loadSkillsFromDir, openPiResources } from "./pi-sdk.js";
import type { LoadSkillsResult } from "./pi-sdk.js";

/**
 * Builds `{skills, packages}` exactly as Pi would load them, computed fresh on every call — no
 * cache, no Pi-Studio-owned resource state (swe/architecture/pi-resource-management.md tenet 1,
 * § List). Pure over its `BuildCatalogContext` input: every path it reads is either passed in or
 * derived from Pi's own resolver output.
 */

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** `"agent_dir" | "agents_dir" | "package" | "settings_path"` — see § Behavior & algorithms
 *  "List" in the architecture doc. Kept as a literal union internally; the wire `skillInfoSchema`
 *  widens it to `z.string()` so a future Pi origin still parses on an older client. */
export type SkillOrigin = "agent_dir" | "agents_dir" | "package" | "settings_path";

export interface SkillProvenance {
  source: string;
  sourceUrl?: string;
  installedAt?: string;
}

/** One resolved Agent Skill row. Matches `SkillInfo` (`packages/protocol`) field-for-field, plus
 *  `baseDir` — kept internally for the toggle task (task-004)'s pattern derivation
 *  (`toggle-patterns.ts`'s `topLevelPattern`/`packagePattern`), never sent on the wire. */
export interface CatalogSkill {
  name: string;
  description?: string;
  path: string;
  enabled: boolean;
  origin: SkillOrigin;
  originLabel: string;
  packageSource?: string;
  shadowedBy?: string;
  symlinkTarget?: string;
  provenance?: SkillProvenance;
  disableModelInvocation?: boolean;
  warnings?: string[];
  removable: boolean;
  /** Internal only: the pattern base for a future toggle (`relative(baseDir, path)`), never
   *  `agentDir` itself when the resource's own origin provides a more specific one. */
  baseDir: string;
}

/** One `settings.json` `packages[]` entry resolved against disk. Matches `PiPackageInfo`
 *  field-for-field. */
export interface CatalogPackage {
  source: string;
  kind: "npm" | "git" | "local";
  identity: string;
  pinned: boolean;
  curated: boolean;
  filtered: boolean;
  skillCount: number;
}

export interface BuildCatalogContext {
  /** `effectivePiHomeKey(config)` — `<agentDir>/settings.json`, `<agentDir>/skills`. */
  agentDir: string;
  /** `$HOME` — `~/.agents/skills` is resolved from this, not from `agentDir`
   *  (`package-manager.js:83,2023`; architecture doc § Ground truth). Also `SettingsManager`'s
   *  `cwd` (project-scope settings are not consulted by this sprint's slice but `SettingsManager`
   *  still needs a `cwd` to construct). */
  home: string;
  /** `$XDG_STATE_HOME/skills/.skill-lock.json` if set, else `~/.agents/.skill-lock.json` — the
   *  caller computes this (architecture doc § Behavior & algorithms `ctx()`), not this module. */
  lockPath: string;
}

export type BuildCatalogResult =
  | { ok: true; skills: CatalogSkill[]; packages: CatalogPackage[] }
  | { ok: false; error: "settings_unreadable" };

// ---------------------------------------------------------------------------
// buildCatalog
// ---------------------------------------------------------------------------

export async function buildCatalog(ctx: BuildCatalogContext): Promise<BuildCatalogResult> {
  const settingsPath = resolvePathAbs(ctx.agentDir, "settings.json");
  if (existsSync(settingsPath)) {
    try {
      JSON.parse(await readFile(settingsPath, "utf8"));
    } catch {
      return { ok: false, error: "settings_unreadable" };
    }
  }

  const { packages } = await openPiResources(ctx.agentDir, ctx.home);
  const resolved = await packages.resolve(async () => "skip");
  const userSkills = resolved.skills.filter((r) => r.metadata.scope === "user");

  const lock = await readLock(ctx.lockPath);

  // Per-path frontmatter/warnings via `loadSkillsFromDir`, cached per scan root (the directory
  // containing the SKILL.md, or the shared skills root for a loose `.md` sibling) so two resolved
  // paths under the same root share one scan.
  const scanCache = new Map<string, LoadSkillsResult>();
  function scan(dir: string): LoadSkillsResult {
    let result = scanCache.get(dir);
    if (!result) {
      result = loadSkillsFromDir({ dir, source: "catalog" });
      scanCache.set(dir, result);
    }
    return result;
  }

  const rows: CatalogSkill[] = [];
  for (const r of userSkills) {
    const skillDir = dirname(r.path);
    const { skills: scanned, diagnostics } = scan(skillDir);
    const match = scanned.find((s) => resolvePathAbs(s.filePath) === resolvePathAbs(r.path));
    const warnings = diagnostics
      .filter(
        (d) => d.type === "warning" && d.path && resolvePathAbs(d.path) === resolvePathAbs(r.path),
      )
      .map((d) => d.message);

    const origin = classifyOrigin(r.metadata, ctx.agentDir);
    const originLabel = originLabelFor(origin, r.metadata.source);
    const baseDir = r.metadata.baseDir ?? ctx.agentDir;

    let symlinkTarget: string | undefined;
    try {
      const st = await lstat(skillDir);
      if (st.isSymbolicLink()) symlinkTarget = await realpath(skillDir);
    } catch {
      // Directory vanished between resolve() and here, or isn't readable — no symlink to report.
    }

    const name = match?.name ?? basename(skillDir);
    let provenance: SkillProvenance | undefined;
    if (origin === "agents_dir") {
      const entry = lock[name];
      if (entry) provenance = entry;
    }

    rows.push({
      name,
      description: match?.description,
      path: r.path,
      enabled: r.enabled,
      origin,
      originLabel,
      packageSource: origin === "package" ? r.metadata.source : undefined,
      symlinkTarget,
      provenance,
      disableModelInvocation: match?.disableModelInvocation,
      warnings: warnings.length > 0 ? warnings : undefined,
      removable: origin !== "package",
      baseDir,
    });
  }

  // Shadowing: first-wins by name over ENABLED rows only, in `resolve()`'s own precedence order
  // (`userSkills` is already sorted project-first/local-before-auto-before-package by
  // `resourcePrecedenceRank`, stable-sorted within equal ranks — agent_dir before agents_dir on a
  // name collision, matching Pi's own first-wins semantics, D19). A disabled duplicate never wins
  // or shadows: it is simply excluded from this pass.
  const winnerPathByName = new Map<string, string>();
  for (const row of rows) {
    if (!row.enabled) continue;
    const winnerPath = winnerPathByName.get(row.name);
    if (winnerPath === undefined) {
      winnerPathByName.set(row.name, row.path);
    } else {
      row.shadowedBy = winnerPath;
    }
  }

  const packagesList = buildPackages(packages.listConfiguredPackages(), userSkills);

  return { ok: true, skills: rows, packages: packagesList };
}

// ---------------------------------------------------------------------------
// Origin classification
// ---------------------------------------------------------------------------

function classifyOrigin(
  metadata: { origin: "package" | "top-level"; source: string; baseDir?: string },
  agentDir: string,
): SkillOrigin {
  if (metadata.origin === "package") return "package";
  // Explicit `settings.skills` plain-path entries are tagged `source: "local"`
  // (`resolveLocalEntries`); auto-discovered directories are tagged `source: "auto"`
  // (`addAutoDiscoveredResources`) and distinguished from each other by `baseDir`:
  // `<agentDir>` for `<agentDir>/skills`, `~/.agents` (from `$HOME`) for `~/.agents/skills`.
  if (metadata.source === "local") return "settings_path";
  return metadata.baseDir !== undefined &&
    resolvePathAbs(metadata.baseDir) === resolvePathAbs(agentDir)
    ? "agent_dir"
    : "agents_dir";
}

function originLabelFor(origin: SkillOrigin, packageSource: string): string {
  switch (origin) {
    case "agent_dir":
      return "Pi skills";
    case "agents_dir":
      return "Agent Skills";
    case "settings_path":
      return "Skill paths";
    case "package":
      return packageSource;
  }
}

// ---------------------------------------------------------------------------
// Lock file (`~/.agents/.skill-lock.json`, v3)
// ---------------------------------------------------------------------------

async function readLock(lockPath: string): Promise<Record<string, SkillProvenance>> {
  if (!existsSync(lockPath)) return {};
  try {
    const raw: unknown = JSON.parse(await readFile(lockPath, "utf8"));
    if (
      raw === null ||
      typeof raw !== "object" ||
      (raw as Record<string, unknown>).version !== 3 ||
      typeof (raw as Record<string, unknown>).skills !== "object"
    ) {
      // Pre-v3 (or malformed) lock file: rows load without provenance; the `skills` CLI rewrites
      // the file to v3 on its next write (architecture doc § Error handling & edge cases).
      return {};
    }
    const out: Record<string, SkillProvenance> = {};
    const entries = (raw as Record<string, unknown>).skills as Record<string, unknown>;
    for (const [name, value] of Object.entries(entries)) {
      if (value === null || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      if (typeof entry.source !== "string") continue;
      out[name] = {
        source: entry.source,
        sourceUrl: typeof entry.sourceUrl === "string" ? entry.sourceUrl : undefined,
        installedAt: typeof entry.installedAt === "string" ? entry.installedAt : undefined,
      };
    }
    return out;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------

interface ClassifiedSource {
  kind: "npm" | "git" | "local";
  identity: string;
  pinned: boolean;
}

/** `npm:`/`git:` reuse `curated-packs.ts`'s own parser (Pi's dedup key, ref/version stripped);
 *  anything else is a local path, whose identity is the literal configured source string. */
function classifySource(source: string): ClassifiedSource {
  if (source.startsWith("npm:") || source.startsWith("git:")) {
    return parseCuratedSource(source);
  }
  return { kind: "local", identity: source, pinned: false };
}

const CURATED_IDENTITIES = new Set(
  Object.values(CURATED_PACKS).flatMap((pack) =>
    pack.packages.map((entry) => classifySource(entry.source).identity),
  ),
);

function buildPackages(
  configured: { source: string; scope: "user" | "project"; filtered: boolean }[],
  userSkills: { metadata: { origin: "package" | "top-level"; source: string } }[],
): CatalogPackage[] {
  const skillCountByIdentity = new Map<string, number>();
  for (const r of userSkills) {
    if (r.metadata.origin !== "package") continue;
    const identity = classifySource(r.metadata.source).identity;
    skillCountByIdentity.set(identity, (skillCountByIdentity.get(identity) ?? 0) + 1);
  }

  return configured
    .filter((entry) => entry.scope === "user")
    .map((entry) => {
      const classified = classifySource(entry.source);
      return {
        source: entry.source,
        kind: classified.kind,
        identity: classified.identity,
        pinned: classified.pinned,
        curated: CURATED_IDENTITIES.has(classified.identity),
        filtered: entry.filtered,
        skillCount: skillCountByIdentity.get(classified.identity) ?? 0,
      };
    });
}
