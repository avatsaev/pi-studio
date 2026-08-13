import { join } from "node:path";

import { persistExtensionPacks, type PersistedConfig } from "../config/daemon-config.js";
import type { Logger } from "../logging/logger.js";
import { createLimiter } from "../util/concurrency.js";
import { CURATED_PACKS, selectEntries } from "./curated-packs.js";
import {
  effectivePiHomeKey,
  loadExtensionsState,
  readPiSettingsPackages,
  saveExtensionsState,
  type PiHomeState,
} from "./extensions-state.js";
import { attachLastErrors, planSync, type DescribedEntry } from "./sync-planner.js";
import { executePlan, type InstallSpawn, type SyncReport } from "./sync-executor.js";

/**
 * Orchestration only: reads `settings.json` + state, hands them to the pure planner, runs the plan
 * through the executor, persists the `lastSync` summary, and logs the loud-but-not-alarming
 * first-sync report (swe/features/preinstalled-extensions.md § Lifecycle, § Concurrency).
 * Every real decision lives in `sync-planner.ts`/`sync-executor.ts` — this class never decides
 * *what* to install, only *when* and *whether*.
 */

export type SyncReason = "bootstrap" | "manual" | "selection";

export type { DescribedEntry };

export interface ExtensionsDescribe {
  autoSync: boolean;
  selected: string[];
  entries: DescribedEntry[];
  /** `outcome` is read back as a plain `string`, not the narrow `SyncReport["outcome"]` union —
   *  the persisted field is forward-compat (a future daemon's new outcome value must round-trip
   *  through an older one without a type mismatch). */
  lastSync?: { at: string; outcome: string };
}

export class ExtensionsService {
  private readonly home: string;
  private readonly config: PersistedConfig;
  private readonly logger: Logger;
  private readonly spawn: InstallSpawn | undefined;
  /** Where `setSelectedPacks` persists — defaults to `<home>/config.json`, mirroring bootstrap's
   *  own default, so tests that don't care about persistence never need to pass one. */
  private readonly configPath: string;
  // In-process mutex (concurrency-1 limiter): a sync requested while one runs waits for it, then
  // gets its own fresh run — never the same report, since config may have changed in between.
  private readonly mutex = createLimiter(1);

  constructor(deps: {
    home: string;
    config: PersistedConfig;
    logger: Logger;
    spawn?: InstallSpawn;
    configPath?: string;
  }) {
    this.home = deps.home;
    this.config = deps.config;
    this.logger = deps.logger;
    this.spawn = deps.spawn;
    this.configPath = deps.configPath ?? join(deps.home, "config.json");
  }

  sync(reason: SyncReason): Promise<SyncReport> {
    return this.mutex(() => this.runSync(reason));
  }

  /**
   * Updates the service's own selection view *and* persists it, in that order — an
   * in-memory-correct daemon must survive a disk write failure (logged, never thrown; the running
   * daemon keeps serving the new selection even if the write failed). `core` is never stored (it
   * is implicit); dedupes and preserves caller order otherwise.
   */
  async setSelectedPacks(packs: readonly string[]): Promise<void> {
    const deduped = [...new Set(packs.filter((p) => p !== "core"))];
    this.config.daemon.extensions.packs = deduped;
    try {
      await persistExtensionPacks(this.configPath, deduped);
    } catch (err) {
      this.logger.error(
        { err: (err as Error)?.message ?? String(err) },
        "failed to persist extension pack selection to config.json",
      );
    }
  }

  /** Dry-run: the same planner, no writes. One code path for "what we'd do" and "what we
   *  report" — this must never drift from `sync()`'s own plan computation. */
  async describe(): Promise<ExtensionsDescribe> {
    const piHomeKey = effectivePiHomeKey(this.config);
    const [state, settings] = await Promise.all([
      loadExtensionsState(this.home),
      readPiSettingsPackages(piHomeKey),
    ]);
    const piHomeState: PiHomeState | "unreadable" =
      state === "unreadable" ? "unreadable" : (state.piHomes[piHomeKey] ?? emptyPiHomeState());
    const packs = this.config.daemon.extensions.packs;
    const { entries } = planSync({
      catalog: CURATED_PACKS,
      packs,
      state: piHomeState,
      settingsPackages: settings.packages,
    });
    return {
      autoSync: this.config.daemon.extensions.autoSync,
      selected: [...packs],
      entries: attachLastErrors(entries, piHomeState),
      lastSync: state === "unreadable" ? undefined : state.piHomes[piHomeKey]?.lastSync,
    };
  }

  /** Persists only the `{ at, outcome }` summary (never the full report) so a freshly-booted
   *  daemon that hasn't synced yet can still report the previous run via `describe()`. Re-reads
   *  state first so this never clobbers what `executePlan` just wrote per-action; silently no-ops
   *  if the state file is unreadable (never rewrite a corrupt file, even for this). */
  private async recordLastSync(
    piHomeKey: string,
    summary: { at: string; outcome: SyncReport["outcome"] },
  ): Promise<void> {
    const loaded = await loadExtensionsState(this.home);
    if (loaded === "unreadable") return;
    const slice = loaded.piHomes[piHomeKey] ?? emptyPiHomeState();
    slice.lastSync = summary;
    loaded.piHomes[piHomeKey] = slice;
    await saveExtensionsState(this.home, loaded);
  }

  private async runSync(reason: SyncReason): Promise<SyncReport> {
    // `autoSync: false` gates bootstrap/selection entirely — Pi-Studio never touches pi's settings.
    // `manual` is the deliberate escape hatch (`extensions sync` must work even with the switch
    // off); no plan is even computed here, so no lastSync write either — nothing was attempted.
    if (!this.config.daemon.extensions.autoSync && reason !== "manual") {
      this.logger.debug(
        { reason },
        "extensions sync skipped — daemon.extensions.autoSync is false",
      );
      return { at: new Date().toISOString(), outcome: "noop", installed: [], failures: [] };
    }

    const piHomeKey = effectivePiHomeKey(this.config);
    const settings = await readPiSettingsPackages(piHomeKey);
    if (!settings.ok) {
      this.logger.warn(
        { piHomeKey },
        "settings.json is malformed — extensions sync skipped for this pi-home",
      );
      const report: SyncReport = {
        at: new Date().toISOString(),
        outcome: "skipped",
        installed: [],
        failures: [],
      };
      await this.recordLastSync(piHomeKey, { at: report.at, outcome: report.outcome });
      return report;
    }

    const state = await loadExtensionsState(this.home);
    if (state === "unreadable") {
      this.logger.error(
        { piHomeKey },
        "extensions-state.json is unreadable — extensions sync skipped",
      );
      // Never rewrite the corrupt file — not even to record this attempt as lastSync.
      return { at: new Date().toISOString(), outcome: "skipped", installed: [], failures: [] };
    }

    const packs = this.config.daemon.extensions.packs;
    const { unknownSlugs } = selectEntries(CURATED_PACKS, packs);
    if (unknownSlugs.length > 0) {
      this.logger.warn({ unknownSlugs }, "ignoring unknown extension pack slug(s) in config");
    }

    const piHomeState = state.piHomes[piHomeKey] ?? emptyPiHomeState();
    const plan = planSync({
      catalog: CURATED_PACKS,
      packs,
      state: piHomeState,
      settingsPackages: settings.packages,
    });

    const report = await executePlan(plan, {
      home: this.home,
      piHomeKey,
      config: this.config,
      spawn: this.spawn,
      logger: this.logger,
    });

    if (plan.actions.length > 0) {
      const failedSources = report.failures.map((f) => f.source).join(", ");
      const summary =
        `installed ${report.installed.length} of ${plan.actions.length} recommended extensions ` +
        `into ${piHomeKey}; ${report.failures.length} failed` +
        (report.failures.length > 0 ? `: ${failedSources} (will retry on next start)` : "") +
        " — disable via daemon.extensions.autoSync=false / PI_STUDIO_EXTENSIONS_AUTOSYNC=false";
      if (report.outcome === "partial" || report.outcome === "failed") this.logger.warn(summary);
      else this.logger.info(summary);
    }

    await this.recordLastSync(piHomeKey, { at: report.at, outcome: report.outcome });
    return report;
  }
}

function emptyPiHomeState(): PiHomeState {
  return { offered: {}, failures: {} };
}
