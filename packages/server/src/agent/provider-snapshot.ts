import type { AgentModeDefinition, AgentModelDefinition } from "./provider-contract.js";

/**
 * Per-cwd provider snapshot cache (features/agent-providers.md § Provider snapshot refresh contract).
 *
 * Hard correctness/perf contract: a snapshot probes only while **cold**; once warm
 * (`ready`/`error`/`unavailable`) it stays cached until an **explicit refresh** — no TTL, focus,
 * selector-open, or config-reload revalidation. **Settings refresh** clears all cwd-scope caches +
 * in-flight loads, then refreshes only the home snapshot with `force:true`; workspace snapshots
 * re-probe lazily.
 */

export type SnapshotStatus = "cold" | "loading" | "ready" | "error" | "unavailable";

export interface ProviderSnapshotData {
  available: boolean;
  models: AgentModelDefinition[];
  modes: AgentModeDefinition[];
}

export interface ProviderSnapshot {
  cwd: string;
  status: SnapshotStatus;
  data?: ProviderSnapshotData;
  error?: string;
}

const WARM: ReadonlySet<SnapshotStatus> = new Set(["ready", "error", "unavailable"]);

export interface SnapshotManagerDeps {
  /** Resolved home directory; blank cwd resolves here. */
  homeDir: string;
  /** Probe a cwd (this is where Pi would be spawned). Throws → `error`; `available:false` → `unavailable`. */
  probe: (cwd: string) => Promise<ProviderSnapshotData>;
}

export class ProviderSnapshotManager {
  private readonly cache = new Map<string, ProviderSnapshot>();
  private readonly inflight = new Map<string, Promise<ProviderSnapshot>>();

  constructor(private readonly deps: SnapshotManagerDeps) {}

  /** Resolve a cwd; blank/empty → home. */
  resolveCwd(cwd?: string): string {
    return cwd && cwd.trim().length > 0 ? cwd : this.deps.homeDir;
  }

  /**
   * Get the snapshot for `cwd`. Returns the cached warm snapshot without re-probing; probes only
   * when cold (or `force:true`). Concurrent cold reads share one probe.
   */
  get(cwd?: string, opts?: { force?: boolean }): Promise<ProviderSnapshot> {
    const key = this.resolveCwd(cwd);

    if (opts?.force) {
      this.cache.delete(key);
      this.inflight.delete(key);
    } else {
      const cached = this.cache.get(key);
      if (cached && WARM.has(cached.status)) return Promise.resolve(cached);
      const loading = this.inflight.get(key);
      if (loading) return loading;
    }

    const probe = this.probeInto(key);
    this.inflight.set(key, probe);
    return probe;
  }

  /** The current cached snapshot (if any) without triggering a probe. */
  peek(cwd?: string): ProviderSnapshot | undefined {
    return this.cache.get(this.resolveCwd(cwd));
  }

  private async probeInto(key: string): Promise<ProviderSnapshot> {
    try {
      const data = await this.deps.probe(key);
      const snapshot: ProviderSnapshot = {
        cwd: key,
        status: data.available ? "ready" : "unavailable",
        data,
      };
      this.cache.set(key, snapshot);
      return snapshot;
    } catch (error) {
      const snapshot: ProviderSnapshot = {
        cwd: key,
        status: "error",
        error: (error as Error)?.message ?? String(error),
      };
      this.cache.set(key, snapshot);
      return snapshot;
    } finally {
      this.inflight.delete(key);
    }
  }

  /**
   * Settings refresh: clear every cwd-scope cache + in-flight load, then immediately re-probe only
   * the home snapshot with `force:true`. Workspace snapshots re-probe lazily on next `get`.
   */
  refreshSettings(): Promise<ProviderSnapshot> {
    this.cache.clear();
    this.inflight.clear();
    return this.get(this.deps.homeDir, { force: true });
  }
}
