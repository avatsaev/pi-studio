import { homedir } from "node:os";
import { join } from "node:path";

import type { PiPackageInfo, SkillInfo } from "@av-pi-studio/protocol";

import type { PersistedConfig } from "../config/daemon-config.js";
import { effectivePiHomeKey } from "../extensions/extensions-state.js";
import type { FileWatchService } from "../files/file-watch-service.js";
import type { Logger } from "../logging/logger.js";
import type { Session } from "../ws/session.js";
import { openPiResources } from "./pi-sdk.js";
import { buildCatalog } from "./skill-catalog.js";
import {
  applyPackageToggle,
  packagePattern,
  replacePattern,
  topLevelPattern,
} from "./toggle-patterns.js";
import { toPiPackageInfoList, toSkillInfoList } from "./wire.js";

/**
 * `ResourceService`: list/toggle over Pi's skills + packages, plus the daemon-lifetime file
 * watcher that notices an *external* edit to `settings.json`/the skill directories
 * (swe/architecture/pi-resource-management.md § Behavior & algorithms — "List"/"Toggle", § Queue,
 * watcher, broadcast). No cache (tenet 1): every call re-derives `ctx()` and re-resolves the
 * catalog from disk.
 *
 * `list()`/`setEnabled()` bypass the (not-yet-built, sprint-076) FIFO install/remove/update-all
 * queue entirely (D21) — Pi's own `proper-lockfile`-backed `SettingsManager` write serializes
 * concurrent writers at the file level, so no in-process mutex is needed for these two operations.
 */

const DEFAULT_EXTERNAL_DEBOUNCE_MS = 500;

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
