import { existsSync, statSync } from "node:fs";
import { lstat, mkdir, mkdtemp, realpath, rm, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve as resolvePathAbs, sep } from "node:path";

import {
  detectSkillSource,
  type DetectedSkillSource,
  type ItemResult,
  type PiPackageInfo,
  type PreviewSkill,
  type SkillInfo,
} from "@av-pi-studio/protocol";

import { resolveBundledPiCli } from "../agent/providers/pi/rpc-transport.js";
import type { PersistedConfig } from "../config/daemon-config.js";
import { parseSource as parseCuratedSource } from "../extensions/curated-packs.js";
import { effectivePiHomeKey } from "../extensions/extensions-state.js";
import { defaultInstallSpawn, type InstallSpawn } from "../extensions/sync-executor.js";
import type { FileWatchService } from "../files/file-watch-service.js";
import { expandHome } from "../files/resolve-path.js";
import type { Logger } from "../logging/logger.js";
import { createLimiter } from "../util/concurrency.js";
import type { Session } from "../ws/session.js";
import { loadSkillsFromDir, openPiResources } from "./pi-sdk.js";
import { buildCatalog } from "./skill-catalog.js";
import { resolveSkillsCli, sanitizeSkillName, skillsArgv, spawnEnv } from "./skills-cli.js";
import {
  processEnvSnapshot,
  redactSource,
  runSpawn as runSpawnImpl,
  type SpawnOutcome,
} from "./spawn-runner.js";
import {
  applyPackageToggle,
  packagePattern,
  replacePattern,
  topLevelPattern,
  type PiPackageEntry,
  type PiPackageSource,
} from "./toggle-patterns.js";
import { toPiPackageInfoList, toSkillInfoList } from "./wire.js";

/**
 * `ResourceService`: list/toggle over Pi's skills + packages, the daemon-lifetime file watcher
 * that notices an *external* edit to `settings.json`/the skill directories, and the FIFO queue +
 * spawn/redaction/logging machinery shared by every mutating operation (`install`/`remove`/
 * `update_all` — tasks 004/005/077; swe/architecture/pi-resource-management.md § Behavior &
 * algorithms — "List"/"Toggle", § Queue, watcher, broadcast, § Spawn environment, § Redaction &
 * logging). No cache (tenet 1): every call re-derives `ctx()` and re-resolves the catalog from
 * disk.
 *
 * `list()`/`setEnabled()` bypass the FIFO install/remove/update-all queue entirely (D21) — Pi's
 * own `proper-lockfile`-backed `SettingsManager` write serializes concurrent writers at the file
 * level, so no in-process mutex is needed for these two operations.
 */

const DEFAULT_EXTERNAL_DEBOUNCE_MS = 500;

/** Daemon-side bound for every `remove`/`update_all` spawn (architecture doc § Timeouts —
 *  "install, remove, update_all | 600 s per spawn"). */
const SPAWN_TIMEOUT_MS = 600_000;

/** Daemon-side bound for the preview `git clone` (architecture doc § Timeouts — "preview | 120 s"). */
const PREVIEW_CLONE_TIMEOUT_MS = 120_000;

export interface ResourceServiceResult {
  ok: boolean;
  /** Free-form domain error string (e.g. `"settings_unreadable"`, `"not_found"`, or a descriptive
   *  malformed-request message) — never thrown as an `rpc_error`. */
  error?: string;
  skills: SkillInfo[];
  packages: PiPackageInfo[];
}

export interface PreviewResult {
  ok: boolean;
  error?: string;
  message?: string;
  kind: string;
  source: string;
  skills: PreviewSkill[];
}

export interface InstallResult {
  ok: boolean;
  error?: string;
  results: ItemResult[];
  skills: SkillInfo[];
  packages: PiPackageInfo[];
}

export interface ResourceServiceDeps {
  config: PersistedConfig;
  fileWatchService: FileWatchService;
  broadcast: (sessions: Iterable<Session>, message: unknown) => void;
  getActiveSessions: () => Iterable<Session>;
  logger?: Logger;
  /** Overridable for tests; defaults to 500 ms (architecture doc § Queue, watcher, broadcast). */
  externalDebounceMs?: number;
  /** Injectable process seam for queued mutations (`runSpawn`); defaults to
   *  `defaultInstallSpawn` (`extensions/sync-executor.ts`). Tests pass a fake. */
  spawn?: InstallSpawn;
  /** `$PI_STUDIO_HOME` — root of the preview scratch directory (`<studioHome>/tmp/preview-*`,
   *  task-003). Defaults to `process.env.PI_STUDIO_HOME ?? ~/.pi-studio`, mirroring
   *  `daemon/bootstrap.ts`'s own `resolveHome`. */
  studioHome?: string;
}

interface ResourceCtx {
  agentDir: string;
  /** `$HOME` — `~/.agents/skills` resolves from this, not `agentDir` (architecture doc § Ground
   *  truth); also `SettingsManager`'s `cwd` (`skill-catalog.ts`'s own `BuildCatalogContext.home`
   *  doc). */
  home: string;
  agentsSkillsDir: string;
  lockPath: string;
}

/** `$XDG_STATE_HOME/skills/.skill-lock.json` if set, else `~/.agents/.skill-lock.json`
 *  (architecture doc § Behavior & algorithms `ctx()`, `skills` CLI 1.7.4 ground truth). */
function resolveLockPath(home: string): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  return xdgStateHome
    ? join(xdgStateHome, "skills", ".skill-lock.json")
    : join(home, ".agents", ".skill-lock.json");
}

function buildCtx(config: PersistedConfig): ResourceCtx {
  const home = homedir();
  return {
    agentDir: effectivePiHomeKey(config),
    home,
    agentsSkillsDir: join(home, ".agents", "skills"),
    lockPath: resolveLockPath(home),
  };
}

/** `npm:`/`git:` dedup key, ref/version stripped, mirroring `skill-catalog.ts`'s own (unexported)
 *  `classifySource` — `null` for anything `curated-packs.ts`'s `parseSource` rejects (a
 *  `local_path` settings entry sitting alongside a `pi_npm`/`pi_git` one), which never matches
 *  (task-004's `installPiPackage` only ever searches for an `npm:`/`git:` identity). */
function piPackageIdentity(source: string): string | null {
  try {
    return parseCuratedSource(source).identity;
  } catch {
    return null;
  }
}

interface SkillsRepoSource {
  cloneUrl: string;
  ref?: string;
  subpath?: string;
}

/** Derive a `git clone` URL (+ optional `--branch ref` / subpath) from a `skills_repo`-classified
 *  source (task-003 preview). Mirrors the relevant branches of the `skills` CLI's own
 *  `parseSource` (`dist/cli.mjs`) just enough to shallow-clone and locate the right subtree:
 *  - A GitHub/GitLab host URL's `/tree/<ref>/<path>` segment supplies both `ref` and `subpath`;
 *    without it, the bare repo URL is cloned at its default branch.
 *  - `owner/repo` (optionally `@<skill-name>` — a post-clone skill-name filter for `skills add`,
 *    not a git ref or subpath; preview deliberately ignores it and shows the whole repo) clones
 *    `https://github.com/<owner>/<repo>.git`.
 *  - Anything else (scp-like `git@host:…`, `ssh://…`, any `*.git`-suffixed URL) clones the
 *    normalized source verbatim. */
function parseSkillsRepoSource(normalized: string): SkillsRepoSource {
  if (/^https?:\/\//i.test(normalized)) {
    try {
      const url = new URL(normalized);
      const segments = url.pathname.split("/").filter((s) => s.length > 0);
      const [owner, rawRepo, marker, ref, ...subpathSegments] = segments;
      if (owner && rawRepo) {
        const repo = rawRepo.replace(/\.git$/, "");
        const cloneUrl = `${url.protocol}//${url.host}/${owner}/${repo}.git`;
        if (marker === "tree" && ref) {
          return {
            cloneUrl,
            ref,
            subpath: subpathSegments.length > 0 ? subpathSegments.join("/") : undefined,
          };
        }
        return { cloneUrl };
      }
    } catch {
      // Malformed URL despite matching `GIT_HOST_URL_RE`/`GIT_SUFFIX_URL_RE` upstream — fall
      // through to cloning the normalized string as-is below.
    }
  }

  const ownerRepoMatch = /^([^/]+)\/([^/@]+)(?:@.+)?$/.exec(normalized);
  if (ownerRepoMatch) {
    const [, owner, rawRepo] = ownerRepoMatch;
    return { cloneUrl: `https://github.com/${owner}/${(rawRepo ?? "").replace(/\.git$/, "")}.git` };
  }

  return { cloneUrl: normalized };
}

export class ResourceService {
  private readonly config: PersistedConfig;
  private readonly fileWatchService: FileWatchService;
  private readonly broadcastFn: (sessions: Iterable<Session>, message: unknown) => void;
  private readonly getActiveSessions: () => Iterable<Session>;
  private readonly logger: Logger | undefined;
  private readonly externalDebounceMs: number;
  private readonly spawnFn: InstallSpawn;
  /** `$PI_STUDIO_HOME` — preview scratch root (task-003). */
  private readonly studioHome: string;
  /** FIFO for preview/install/remove/update_all (tasks 004/005/077) — separate from
   *  `ExtensionsService`'s own sync mutex; `list`/`setEnabled` bypass it entirely (D21,
   *  architecture doc § Queue, watcher, broadcast). */
  private readonly queue = createLimiter(1);

  private watcherStarted = false;
  private externalTimer: NodeJS.Timeout | undefined;
  /** Timestamp (ms) until which an incoming fs event is attributed to this service's own last
   *  write, not an external edit — see {@link markOwnWrite} / {@link handleFsEvent}. */
  private ownWriteUntil = 0;

  constructor(deps: ResourceServiceDeps) {
    this.config = deps.config;
    this.fileWatchService = deps.fileWatchService;
    this.broadcastFn = deps.broadcast;
    this.getActiveSessions = deps.getActiveSessions;
    this.logger = deps.logger;
    this.externalDebounceMs = deps.externalDebounceMs ?? DEFAULT_EXTERNAL_DEBOUNCE_MS;
    this.spawnFn = deps.spawn ?? defaultInstallSpawn;
    this.studioHome =
      deps.studioHome ?? process.env.PI_STUDIO_HOME ?? join(homedir(), ".pi-studio");
  }

  async list(): Promise<ResourceServiceResult> {
    const ctx = buildCtx(this.config);
    this.ensureWatcher(ctx);
    return this.loadResult(ctx);
  }

  /**
   * `skills_preview_request` (architecture doc § Behavior & algorithms "Preview", task-003):
   * stateless — `pi_npm`/`pi_git` answer `{kind, skills: []}` immediately (nothing to pick);
   * `local_path` scans the host folder in place; `skills_repo` shallow-clones into a scratch dir
   * under `<studioHome>/tmp/preview-*`, removed in `finally` regardless of outcome. Queued behind
   * {@link queue} alongside install/remove/update_all (architecture doc § Queue, watcher,
   * broadcast), but — unlike {@link enqueueMutation} — never writes to `settings.json`, so it
   * skips `markOwnWrite`/re-list/broadcast entirely.
   */
  async preview(source: string): Promise<PreviewResult> {
    return this.queue(() => this.previewLocked(source));
  }

  private async previewLocked(source: string): Promise<PreviewResult> {
    const ctx = buildCtx(this.config);
    const detected = detectSkillSource(source);
    if (!detected) {
      return { ok: false, error: "invalid_source", kind: "invalid_source", source, skills: [] };
    }
    const { kind, normalized } = detected;

    if (kind === "pi_npm" || kind === "pi_git") {
      // Packages install as a unit (R3) — nothing to pick, so no scan is needed.
      return { ok: true, kind, source, skills: [] };
    }

    if (kind === "local_path") {
      const root = expandHome(normalized);
      if (!existsSync(root) || !statSync(root).isDirectory()) {
        return { ok: false, error: "invalid_source", kind, source, skills: [] };
      }
      return this.buildPreviewResult(ctx, kind, source, root);
    }

    return this.previewSkillsRepo(ctx, kind, source, normalized);
  }

  /** `skills_repo`: shallow clone into a scratch dir, scan it (honouring a `/tree/<ref>/<path>`
   *  subpath), then remove the scratch dir unconditionally. */
  private async previewSkillsRepo(
    ctx: ResourceCtx,
    kind: DetectedSkillSource["kind"],
    source: string,
    normalized: string,
  ): Promise<PreviewResult> {
    const { cloneUrl, ref, subpath } = parseSkillsRepoSource(normalized);
    const tmpRoot = join(this.studioHome, "tmp");
    await mkdir(tmpRoot, { recursive: true });
    const scratch = await mkdtemp(join(tmpRoot, "preview-"));
    try {
      const cloneArgs = ["clone", "--depth", "1"];
      if (ref) cloneArgs.push("--branch", ref);
      cloneArgs.push(cloneUrl, scratch);
      const outcome = await this.runSpawn(
        ["git", ...cloneArgs],
        { ...processEnvSnapshot(), ...spawnEnv(ctx.agentDir) },
        PREVIEW_CLONE_TIMEOUT_MS,
      );
      if (!outcome.ok) {
        return {
          ok: false,
          error: "preview_failed",
          message: outcome.stderr || undefined,
          kind,
          source,
          skills: [],
        };
      }
      const root = subpath ? join(scratch, subpath) : scratch;
      return this.buildPreviewResult(ctx, kind, source, root);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  /** Scans `root` with Pi's own `loadSkillsFromDir`, turning both its loaded `Skill`s (always
   *  `valid: true` — the loader only returns an entry once description validation passes) and its
   *  description-less diagnostics (a `SKILL.md` that failed to load at all — `valid: false`) into
   *  one flat `PreviewSkill[]`, so an invalid skill still gets its own row instead of silently
   *  disappearing (task-003 acceptance #1). */
  private buildPreviewResult(
    ctx: ResourceCtx,
    kind: string,
    source: string,
    root: string,
  ): PreviewResult {
    const { skills, diagnostics } = loadSkillsFromDir({ dir: root, source: "preview" });
    const rows: PreviewSkill[] = [];
    const coveredPaths = new Set(skills.map((s) => resolvePathAbs(s.filePath)));

    for (const skill of skills) {
      const warnings = diagnostics
        .filter(
          (d) => d.path !== undefined && resolvePathAbs(d.path) === resolvePathAbs(skill.filePath),
        )
        .map((d) => d.message);
      rows.push({
        name: skill.name,
        description: skill.description,
        relPath: relative(root, dirname(skill.filePath)).split(sep).join("/"),
        warnings: warnings.length > 0 ? warnings : undefined,
        valid: true,
        exists: existsSync(join(ctx.agentsSkillsDir, sanitizeSkillName(skill.name), "SKILL.md")),
      });
    }

    const seenInvalidPaths = new Set<string>();
    for (const d of diagnostics) {
      if (d.path === undefined) continue;
      const abs = resolvePathAbs(d.path);
      if (coveredPaths.has(abs) || seenInvalidPaths.has(abs)) continue;
      seenInvalidPaths.add(abs);
      const skillDir = dirname(abs);
      const name = basename(skillDir);
      const warnings = diagnostics
        .filter((x) => x.path !== undefined && resolvePathAbs(x.path) === abs)
        .map((x) => x.message);
      rows.push({
        name,
        relPath: relative(root, skillDir).split(sep).join("/"),
        warnings,
        valid: false,
        exists: existsSync(join(ctx.agentsSkillsDir, sanitizeSkillName(name), "SKILL.md")),
      });
    }

    if (!rows.some((r) => r.valid)) {
      return { ok: false, error: "no_valid_skills", kind, source, skills: rows };
    }
    return { ok: true, kind, source, skills: rows };
  }

  async setEnabled(path: string, enabled: boolean): Promise<ResourceServiceResult> {
    const ctx = buildCtx(this.config);
    this.ensureWatcher(ctx);

    const catalog = await buildCatalog({
      agentDir: ctx.agentDir,
      home: ctx.home,
      lockPath: ctx.lockPath,
    });
    if (!catalog.ok) return { ok: false, error: catalog.error, skills: [], packages: [] };

    const row = catalog.skills.find((s) => s.path === path);
    if (!row) {
      return {
        ok: false,
        error: "not_found",
        skills: toSkillInfoList(catalog.skills),
        packages: toPiPackageInfoList(catalog.packages),
      };
    }

    const { settings } = await openPiResources(ctx.agentDir, ctx.home);

    try {
      if (row.origin === "package") {
        if (row.packageSource === undefined) {
          throw new Error("package row without packageSource");
        }
        const pattern = packagePattern(row.path, row.baseDir);
        const updated = applyPackageToggle(
          settings.getPackages(),
          row.packageSource,
          pattern,
          enabled,
        );
        this.markOwnWrite();
        settings.setPackages(updated);
      } else {
        const pattern = topLevelPattern(row.path, row.baseDir, ctx.agentDir);
        const updated = replacePattern(settings.getSkillPaths(), pattern, enabled);
        this.markOwnWrite();
        settings.setSkillPaths(updated);
      }
    } catch (err) {
      // The row was resolved moments ago from a live catalog scan; its package entry vanishing
      // before the write (a concurrent `pi remove`/hand-edit) is a genuine race, not a client bug
      // — surfaced as the same domain `not_found`, never an `rpc_error`.
      this.logger?.warn(
        { err, path },
        "skills_set_enabled_request: package entry vanished mid-toggle",
      );
      return {
        ok: false,
        error: "not_found",
        skills: toSkillInfoList(catalog.skills),
        packages: toPiPackageInfoList(catalog.packages),
      };
    }

    await settings.flush();
    this.broadcastChanged("mutation");
    return this.loadResult(ctx);
  }

  /**
   * `skills_install_request` (architecture doc § Behavior & algorithms "Install", tasks
   * 004/005): dispatches on the daemon's own authoritative `detectSkillSource(source)` — a
   * client-sent `kind` is never trusted. Queued behind {@link enqueueMutation} alongside
   * remove/update_all; `markOwnWrite`/re-list/broadcast are handled there, not here.
   */
  async install(source: string, picked?: string[], replace?: boolean): Promise<InstallResult> {
    const detected = detectSkillSource(source);
    const logKind = detected?.kind ?? "invalid_source";
    return this.enqueueMutation("install", logKind, source, (ctx) =>
      this.installSource(ctx, source, detected, picked, replace),
    );
  }

  private async installSource(
    ctx: ResourceCtx,
    source: string,
    detected: DetectedSkillSource | null,
    picked: string[] | undefined,
    replace: boolean | undefined,
  ): Promise<{ ok: boolean; results: ItemResult[] }> {
    if (!detected) {
      return { ok: false, results: [{ target: source, ok: false, error: "invalid_source" }] };
    }
    switch (detected.kind) {
      case "pi_npm":
      case "pi_git":
        return this.installPiPackage(ctx, detected.normalized);
      case "skills_repo":
        return this.installSkillsRepo(ctx, detected.normalized, picked, replace);
      case "local_path":
        return this.installLocalPath(ctx, detected.normalized);
    }
  }

  /** `pi_npm`/`pi_git` (task-004, R3/R8): spawn bundled `pi install <source>` as a unit, then one
   *  locked write upgrading the matched settings entry to skills-only object form
   *  (`extensions: [], prompts: [], themes: []`) — any pre-existing `skills` filter on that entry
   *  survives untouched (task-001 spike: `addSourceToSettings` only ever rewrites `source`). */
  private async installPiPackage(
    ctx: ResourceCtx,
    source: string,
  ): Promise<{ ok: boolean; results: ItemResult[] }> {
    const cli = resolveBundledPiCli();
    if (!cli) {
      return { ok: false, results: [{ target: source, ok: false, error: "spawn_failed" }] };
    }
    const outcome = await this.runSpawn(
      [process.execPath, cli, "install", source],
      { ...processEnvSnapshot(), ...spawnEnv(ctx.agentDir) },
      SPAWN_TIMEOUT_MS,
    );
    if (!outcome.ok) {
      return {
        ok: false,
        results: [
          {
            target: source,
            ok: false,
            error: outcome.error ?? "install_failed",
            stderr: outcome.stderr,
          },
        ],
      };
    }

    // The install itself succeeded (package fetched, bare `source` written); the filter write is
    // a second, independent step — its own failure never rolls back the install (D25, no
    // rollback): the package row simply shows `filtered: false` on the next list.
    try {
      const identity = piPackageIdentity(source);
      const { settings } = await openPiResources(ctx.agentDir, ctx.home);
      const packages = settings.getPackages();
      const index = packages.findIndex(
        (p) => piPackageIdentity(typeof p === "string" ? p : p.source) === identity,
      );
      if (index === -1) throw new Error("installed package entry not found in settings");
      const existing = packages[index]!;
      const entry: PiPackageEntry =
        typeof existing === "string" ? { source: existing } : { ...existing };
      entry.extensions = [];
      entry.prompts = [];
      entry.themes = [];
      const updated: PiPackageSource[] = [...packages];
      updated[index] = entry;
      this.markOwnWrite();
      settings.setPackages(updated);
      await settings.flush();
    } catch (err) {
      this.logger?.warn({ err, source }, "skills_install: skills-only filter write failed");
      return { ok: false, results: [{ target: source, ok: false, error: "install_failed" }] };
    }

    return { ok: true, results: [{ target: source, ok: true }] };
  }

  /** `skills_repo` (task-005): picked names already present under `agentsSkillsDir` without
   *  `replace` are excluded as `name_exists`, never spawned; the rest go through one `skills add
   *  <url> -g -a pi -y -s <picked…>` spawn, each name's own result decided by a post-spawn
   *  `<agentsSkillsDir>/<sanitized>/SKILL.md` existence check (D18's lock file is `skills`'s own
   *  bookkeeping, never hand-read here for the outcome). */
  private async installSkillsRepo(
    ctx: ResourceCtx,
    source: string,
    picked: string[] | undefined,
    replace: boolean | undefined,
  ): Promise<{ ok: boolean; results: ItemResult[] }> {
    if (!picked || picked.length === 0) {
      return { ok: false, results: [{ target: source, ok: false, error: "invalid_source" }] };
    }

    const toInstall: string[] = [];
    const results: ItemResult[] = [];
    for (const name of picked) {
      const skillDir = join(ctx.agentsSkillsDir, sanitizeSkillName(name), "SKILL.md");
      if (!replace && existsSync(skillDir)) {
        results.push({ target: name, ok: false, error: "name_exists" });
      } else {
        toInstall.push(name);
      }
    }
    if (toInstall.length === 0) {
      return { ok: results.every((r) => r.ok), results };
    }

    const cli = resolveSkillsCli();
    if (!cli) {
      for (const name of toInstall) {
        results.push({ target: name, ok: false, error: "spawn_failed" });
      }
      return { ok: false, results };
    }

    const outcome = await this.runSpawn(
      [process.execPath, cli, ...skillsArgv("add", source, toInstall)],
      { ...processEnvSnapshot(), ...spawnEnv(ctx.agentDir) },
      SPAWN_TIMEOUT_MS,
    );
    for (const name of toInstall) {
      const skillDir = join(ctx.agentsSkillsDir, sanitizeSkillName(name), "SKILL.md");
      results.push(
        existsSync(skillDir)
          ? { target: name, ok: true }
          : {
              target: name,
              ok: false,
              error: outcome.error ?? "install_failed",
              stderr: outcome.stderr,
            },
      );
    }

    return { ok: results.every((r) => r.ok), results };
  }

  /** `local_path` (task-005): nothing copied — `settings.skills` gains one bare `<absPath>`
   *  entry, de-duplicated against any existing entry with the same stripped form (bare or
   *  `±`-prefixed).
   *
   *  Deviation from the architecture doc's literal `"+" + absPath` pseudocode, found by code
   *  inspection of the installed `@earendil-works/pi-coding-agent` 1.4.0
   *  (`package-manager.js`'s `resolveLocalEntries`/`isPattern`/`applyPatterns`): a `±`-prefixed
   *  `settings.skills` entry is parsed as an *override pattern* that only flips the enabled state
   *  of a path already discovered via a *plain* (unprefixed) entry or auto-discovery — it is
   *  never itself scanned for resources. A `+<absPath>` entry with no matching plain entry
   *  resolves zero files. A bare entry, by contrast, goes through `resolveLocalEntries`'s `plain`
   *  branch (`collectFilesFromPaths`), which is exactly what the existing `remove`'s own
   *  `settings_path` handling above already assumes (a bare directory entry, e.g. the
   *  `removes a settings_path entry` test fixture). */
  private async installLocalPath(
    ctx: ResourceCtx,
    source: string,
  ): Promise<{ ok: boolean; results: ItemResult[] }> {
    const absPath = expandHome(source);
    if (!existsSync(absPath) || !statSync(absPath).isDirectory()) {
      return { ok: false, results: [{ target: source, ok: false, error: "invalid_source" }] };
    }

    const { settings } = await openPiResources(ctx.agentDir, ctx.home);
    const deduped = replacePattern(settings.getSkillPaths(), absPath, undefined);
    deduped.push(absPath);
    this.markOwnWrite();
    settings.setSkillPaths(deduped);
    await settings.flush();
    return { ok: true, results: [{ target: absPath, ok: true }] };
  }

  /**
   * `skills_remove_request` (architecture doc § Behavior & algorithms "Remove", D9/D20): removes
   * one top-level skill the way its origin requires, or spawns `pi remove` for a whole package.
   * Queued behind {@link enqueueMutation} alongside install/update_all — `markOwnWrite`/re-list/
   * broadcast are handled there, not here.
   */
  async remove(
    target: { path: string } | { packageSource: string },
  ): Promise<{ ok: boolean; error?: string; stderr?: string } & ResourceServiceResult> {
    if ("path" in target) {
      const { path } = target;
      return this.enqueueMutation("remove", "path", path, (ctx) => this.removeByPath(ctx, path));
    }
    const { packageSource } = target;
    return this.enqueueMutation("remove", "package", packageSource, (ctx) =>
      this.removePackage(ctx, packageSource),
    );
  }

  /** `remove({path})` — settings-path entry, symlink, `skills`-CLI-tracked `agents_dir` skill, or
   *  a plain directory under `agent_dir`/`agents_dir` whose realpath must stay inside that origin
   *  root. Never follows symlinks; never deletes a package row's files (D9). */
  private async removeByPath(
    ctx: ResourceCtx,
    path: string,
  ): Promise<{ ok: boolean; error?: string; stderr?: string }> {
    const catalog = await buildCatalog({
      agentDir: ctx.agentDir,
      home: ctx.home,
      lockPath: ctx.lockPath,
    });
    if (!catalog.ok) return { ok: false, error: catalog.error };

    const row = catalog.skills.find((s) => s.path === path);
    if (!row) return { ok: false, error: "not_found" };
    if (row.origin === "package") return { ok: false, error: "not_removable" };

    const { settings } = await openPiResources(ctx.agentDir, ctx.home);
    const skillDir = dirname(row.path);

    if (row.origin === "settings_path") {
      // Drop every settings entry (any ± form) that provides this skill: the skill's own folder
      // or file, or an ANCESTOR folder — `install`'s `local_path` registers the folder the user
      // named, which may hold several skills (found live, sprint-077: matching only the skill's
      // own dir was a silent `ok` no-op for a registered parent folder, and the skill stayed).
      // Siblings from the same folder entry stop loading with it; files are untouched.
      const entries = settings.getSkillPaths() ?? [];
      const covering = entries.filter((entry) => {
        const bare = /^[!+-]/.test(entry) ? entry.slice(1) : entry;
        const abs = resolvePathAbs(
          ctx.agentDir,
          bare === "~" || bare.startsWith("~/") ? join(ctx.home, bare.slice(1)) : bare,
        );
        return abs === skillDir || abs === row.path || skillDir.startsWith(abs + sep);
      });
      if (covering.length === 0) return { ok: false, error: "not_removable" };
      settings.setSkillPaths(entries.filter((entry) => !covering.includes(entry)));
      await settings.flush();
      return { ok: true };
    }

    let isSymlink = false;
    try {
      isSymlink = (await lstat(skillDir)).isSymbolicLink();
    } catch {
      // Vanished since the catalog scan — nothing to unlink/delete; still clean its toggle
      // pattern below so a stale override doesn't linger.
    }

    if (isSymlink) {
      // Unlinks the link itself — `fs.unlink` never follows a symlink, so the real target
      // directory (e.g. a package install root) is left intact.
      await unlink(skillDir);
    } else if (row.origin === "agents_dir" && row.provenance) {
      const cli = resolveSkillsCli();
      if (!cli) return { ok: false, error: "spawn_failed" };
      const outcome = await this.runSpawn(
        [process.execPath, cli, ...skillsArgv("remove", row.name)],
        { ...processEnvSnapshot(), ...spawnEnv(ctx.agentDir) },
        SPAWN_TIMEOUT_MS,
      );
      if (!outcome.ok) {
        return { ok: false, error: outcome.error ?? "remove_failed", stderr: outcome.stderr };
      }
    } else {
      // A plain directory under `agent_dir`/`agents_dir` with no lock entry (hand-placed, never
      // went through `skills add`). Its realpath must stay inside the origin root before
      // deleting — a directory escaped via a parent symlink is refused untouched.
      const originRoot =
        row.origin === "agent_dir" ? join(ctx.agentDir, "skills") : ctx.agentsSkillsDir;
      let realDir: string;
      let realRoot: string;
      try {
        [realDir, realRoot] = await Promise.all([realpath(skillDir), realpath(originRoot)]);
      } catch {
        return { ok: false, error: "not_found" };
      }
      if (realDir !== realRoot && !realDir.startsWith(realRoot + sep)) {
        return { ok: false, error: "not_removable" };
      }
      await rm(skillDir, { recursive: true, force: true });
    }

    const pattern = topLevelPattern(row.path, row.baseDir, ctx.agentDir);
    settings.setSkillPaths(replacePattern(settings.getSkillPaths(), pattern, undefined));
    await settings.flush();
    return { ok: true };
  }

  /** `remove({packageSource})` — spawns bundled `pi remove <source>`; Pi owns deleting the
   *  package's install root and removing its `packages[]` entry. */
  private async removePackage(
    ctx: ResourceCtx,
    packageSource: string,
  ): Promise<{ ok: boolean; error?: string; stderr?: string }> {
    const catalog = await buildCatalog({
      agentDir: ctx.agentDir,
      home: ctx.home,
      lockPath: ctx.lockPath,
    });
    if (!catalog.ok) return { ok: false, error: catalog.error };
    // The wire only ever carries redacted sources (`wire.ts`), so the request is matched on its
    // redacted form and the spawn gets the REAL entry from settings — never the client's string.
    const requested = redactSource(packageSource);
    const entry = catalog.packages.find((p) => redactSource(p.source) === requested);
    if (!entry) return { ok: false, error: "not_found" };

    const cli = resolveBundledPiCli();
    if (!cli) return { ok: false, error: "spawn_failed" };
    const outcome = await this.runSpawn(
      [process.execPath, cli, "remove", entry.source],
      { ...processEnvSnapshot(), ...spawnEnv(ctx.agentDir) },
      SPAWN_TIMEOUT_MS,
      // `pi remove` resolves a local-path source against its cwd, while the catalog reports the
      // entry as written in `<agentDir>/settings.json` (relative to agentDir) — match Pi's own
      // base so a relative entry like `../../../pkg` is found. Found live in sprint-076/task-008.
      ctx.agentDir,
    );
    if (!outcome.ok) {
      return { ok: false, error: outcome.error ?? "remove_failed", stderr: outcome.stderr };
    }
    return { ok: true };
  }

  /**
   * `skills_update_all_request` (architecture doc § Behavior & algorithms "Update all", R5): one
   * queued operation spawning `skills update -g -y` then `pi update --extensions` in sequence —
   * a failure in the first never skips the second; `ok` is true only when both succeed.
   */
  async updateAll(): Promise<{ ok: boolean; results: ItemResult[] } & ResourceServiceResult> {
    return this.enqueueMutation("update_all", "all", "", async (ctx) => {
      const results: ItemResult[] = [
        await this.updateAgentSkills(ctx),
        await this.updatePiPackages(ctx),
      ];
      return { ok: results.every((r) => r.ok), results };
    });
  }

  private async updateAgentSkills(ctx: ResourceCtx): Promise<ItemResult> {
    const cli = resolveSkillsCli();
    if (!cli) return { target: "agent-skills", ok: false, error: "spawn_failed" };
    const outcome = await this.runSpawn(
      [process.execPath, cli, ...skillsArgv("update")],
      { ...processEnvSnapshot(), ...spawnEnv(ctx.agentDir) },
      SPAWN_TIMEOUT_MS,
    );
    return outcome.ok
      ? { target: "agent-skills", ok: true }
      : {
          target: "agent-skills",
          ok: false,
          error: outcome.error ?? "update_failed",
          stderr: outcome.stderr,
        };
  }

  private async updatePiPackages(ctx: ResourceCtx): Promise<ItemResult> {
    const cli = resolveBundledPiCli();
    if (!cli) return { target: "pi-packages", ok: false, error: "spawn_failed" };
    const outcome = await this.runSpawn(
      [process.execPath, cli, "update", "--extensions"],
      { ...processEnvSnapshot(), ...spawnEnv(ctx.agentDir) },
      SPAWN_TIMEOUT_MS,
    );
    return outcome.ok
      ? { target: "pi-packages", ok: true }
      : {
          target: "pi-packages",
          ok: false,
          error: outcome.error ?? "update_failed",
          stderr: outcome.stderr,
        };
  }

  /** Runs `command` through the injected spawn seam, bounding and redacting its stderr tail
   *  (architecture doc § Spawn environment, § Redaction & logging). Shared by every queued
   *  mutation (install/remove/update_all — tasks 004/005/077); exposed as a method (rather than
   *  requiring every caller to thread `this.spawnFn` through) so operations only need `this`. */
  async runSpawn(
    command: string[],
    env: Record<string, string>,
    timeoutMs: number,
    cwd?: string,
  ): Promise<SpawnOutcome> {
    return runSpawnImpl(this.spawnFn, command, env, timeoutMs, cwd);
  }

  /**
   * FIFO-queues one mutating operation behind {@link queue}, then runs the tail every mutation
   * shares: structured logging (`{op, kind, source, outcome, durationMs}`, warn with the redacted
   * stderr tail on failure), re-list, and `skills_changed("mutation")` broadcast — always, so a
   * failed spawn that still partially touched `settings.json` is reflected (architecture doc
   * § Behavior & algorithms "Install", § Redaction & logging). `fn`'s own `ok`/`error` (the
   * operation's outcome) wins over the re-list's, except when the re-list itself fails (e.g. a
   * `settings.json` that became unreadable mid-operation), which then takes over as the surfaced
   * error — `skills`/`packages` always come from the fresh re-list.
   */
  async enqueueMutation<T extends { ok: boolean; error?: string; stderr?: string }>(
    op: string,
    kind: string,
    source: string,
    fn: (ctx: ResourceCtx) => Promise<T>,
  ): Promise<T & ResourceServiceResult> {
    return this.queue(async () => {
      const ctx = buildCtx(this.config);
      this.ensureWatcher(ctx);
      const redactedSource = redactSource(source);
      const start = Date.now();

      const result = await fn(ctx);
      const durationMs = Date.now() - start;
      const outcome = result.ok ? "ok" : "failed";
      this.logger?.info({ op, kind, source: redactedSource, outcome, durationMs }, `skills_${op}`);
      if (!result.ok) {
        this.logger?.warn(
          { op, kind, source: redactedSource, stderr: result.stderr },
          `skills_${op} failed`,
        );
      }

      this.markOwnWrite();
      const listResult = await this.loadResult(ctx);
      this.broadcastChanged("mutation");

      return {
        ...result,
        skills: listResult.skills,
        packages: listResult.packages,
        ok: result.ok && listResult.ok,
        error: result.ok ? (listResult.ok ? undefined : listResult.error) : result.error,
      } as T & ResourceServiceResult;
    });
  }

  private async loadResult(ctx: ResourceCtx): Promise<ResourceServiceResult> {
    const catalog = await buildCatalog({
      agentDir: ctx.agentDir,
      home: ctx.home,
      lockPath: ctx.lockPath,
    });
    if (!catalog.ok) return { ok: false, error: catalog.error, skills: [], packages: [] };
    return {
      ok: true,
      skills: toSkillInfoList(catalog.skills),
      packages: toPiPackageInfoList(catalog.packages),
    };
  }

  /** Started on the first `skills_*` RPC, lives for the daemon's lifetime (architecture doc
   *  § Queue, watcher, broadcast) — never torn down by this service itself. */
  private ensureWatcher(ctx: ResourceCtx): void {
    if (this.watcherStarted) return;
    this.watcherStarted = true;
    const onFsEvent = (): void => this.handleFsEvent();
    const watched = [
      join(ctx.agentDir, "settings.json"),
      join(ctx.agentDir, "skills"),
      ctx.agentsSkillsDir,
      ctx.lockPath,
    ];
    for (const path of watched) this.fileWatchService.subscribe(path, onFsEvent);
  }

  /** Call immediately before the mutating `SettingsManager` setter so the fold window covers the
   *  resulting disk write and the watcher's own event latency (`FileWatchService`'s internal
   *  coalescing plus this service's own debounce below). */
  private markOwnWrite(): void {
    this.ownWriteUntil = Date.now() + this.externalDebounceMs;
  }

  private handleFsEvent(): void {
    // Folded into the mutation's own broadcast — this event is (almost certainly) an echo of our
    // own write, not a genuine external edit.
    if (Date.now() < this.ownWriteUntil) return;
    // A queued mutation (install/remove/update_all) is in flight or about to run: any fs churn it
    // causes folds into *its* own "mutation" broadcast once it completes (architecture doc
    // § Queue, watcher, broadcast — "Events during a queued mutation fold into its own
    // broadcast").
    if (this.queue.activeCount > 0 || this.queue.pendingCount > 0) return;
    if (this.externalTimer) return; // A burst inside the debounce window collapses to one push.
    this.externalTimer = setTimeout(() => {
      this.externalTimer = undefined;
      this.broadcastChanged("external");
    }, this.externalDebounceMs);
  }

  private broadcastChanged(reason: "mutation" | "external"): void {
    this.broadcastFn(this.getActiveSessions(), { type: "skills_changed", reason });
  }
}
