import { lstat, realpath, rm, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";

import type { ItemResult, PiPackageInfo, SkillInfo } from "@av-pi-studio/protocol";

import { resolveBundledPiCli } from "../agent/providers/pi/rpc-transport.js";
import type { PersistedConfig } from "../config/daemon-config.js";
import { effectivePiHomeKey } from "../extensions/extensions-state.js";
import { defaultInstallSpawn, type InstallSpawn } from "../extensions/sync-executor.js";
import type { FileWatchService } from "../files/file-watch-service.js";
import type { Logger } from "../logging/logger.js";
import { createLimiter } from "../util/concurrency.js";
import type { Session } from "../ws/session.js";
import { openPiResources } from "./pi-sdk.js";
import { buildCatalog } from "./skill-catalog.js";
import { resolveSkillsCli, skillsArgv, spawnEnv } from "./skills-cli.js";
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

export interface ResourceServiceResult {
  ok: boolean;
  /** Free-form domain error string (e.g. `"settings_unreadable"`, `"not_found"`, or a descriptive
   *  malformed-request message) — never thrown as an `rpc_error`. */
  error?: string;
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

export class ResourceService {
  private readonly config: PersistedConfig;
  private readonly fileWatchService: FileWatchService;
  private readonly broadcastFn: (sessions: Iterable<Session>, message: unknown) => void;
  private readonly getActiveSessions: () => Iterable<Session>;
  private readonly logger: Logger | undefined;
  private readonly externalDebounceMs: number;
  private readonly spawnFn: InstallSpawn;
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
  }

  async list(): Promise<ResourceServiceResult> {
    const ctx = buildCtx(this.config);
    this.ensureWatcher(ctx);
    return this.loadResult(ctx);
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
      // The literal directory entry (any ± form), not a derived toggle pattern — mirrors how
      // `install`'s `local_path` branch writes it (architecture doc § Behavior & algorithms
      // "Install"). Files are untouched.
      settings.setSkillPaths(replacePattern(settings.getSkillPaths(), skillDir, undefined));
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
