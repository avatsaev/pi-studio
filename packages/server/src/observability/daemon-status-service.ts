import { monitorEventLoopDelay, performance } from "node:perf_hooks";

import type { DaemonClientInfo, DaemonStatus } from "@av-pi-studio/protocol";

import type { Logger } from "../logging/logger.js";
import { SERVER_VERSION } from "../version.js";
import type { Session } from "../ws/session.js";

/**
 * Daemon status snapshots + per-session push (swe/features/daemon-status-rpc.md § Behavior &
 * algorithms). One shared 5 s timer and one event-loop histogram exist only while at least one
 * session is subscribed; with no subscribers the service holds no timer, no histogram and does
 * no work. Each tick builds ONE snapshot shared by every subscriber.
 */

export const DAEMON_STATUS_INTERVAL_MS = 5000;

/** The slice of `perf_hooks.IntervalHistogram` the service uses. */
export interface EventLoopHistogram {
  enable(): unknown;
  disable(): unknown;
  reset(): void;
  /** Mean delay in nanoseconds; `NaN` before any sample. */
  readonly mean: number;
}

/** Process-level reads, injectable so tests can count calls and feed known values. */
export interface DaemonStatusSampler {
  cpuUsage(): { user: number; system: number };
  memoryUsage(): { rss: number; heapUsed: number; heapTotal: number };
  createEventLoopHistogram(): EventLoopHistogram;
  /** Monotonic milliseconds. */
  now(): number;
  /** Wall-clock epoch milliseconds. */
  wallNow(): number;
}

export const systemSampler: DaemonStatusSampler = {
  cpuUsage: () => process.cpuUsage(),
  memoryUsage: () => process.memoryUsage(),
  createEventLoopHistogram: () => monitorEventLoopDelay({ resolution: 20 }),
  now: () => performance.now(),
  wallNow: () => Date.now(),
};

/** The minimal agent shape the status counts need (`AgentManager.list()` satisfies it). */
export interface StatusAgentView {
  record: { lastStatus: string };
}

export interface DaemonStatusServiceDeps {
  /** Non-archived agents only (`AgentManager.list()`). */
  listAgents(): readonly StatusAgentView[];
  getActiveSessions(): readonly Session[];
  /** Delivers one shared `{type:"session", message}` envelope to a session. May throw. */
  send(session: Session, envelope: unknown): void;
  sampler?: DaemonStatusSampler;
  logger?: Logger;
}

export type DaemonStatusSubscribeResult = {
  ok: true;
  intervalMs: number;
  status: DaemonStatus;
};

interface CpuBaseline {
  micros: number;
  atMs: number;
}

const compareClients = (a: DaemonClientInfo, b: DaemonClientInfo): number =>
  a.connectedAt - b.connectedAt || (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0);

function toClientInfo(session: Session): DaemonClientInfo {
  return {
    clientId: session.clientId,
    clientType: session.clientType,
    ...(session.appVersion !== undefined ? { appVersion: session.appVersion } : {}),
    connectedAt: session.connectedAt,
    ...(session.remoteAddress !== undefined ? { remoteAddress: session.remoteAddress } : {}),
    transport: session.transport,
  };
}

export class DaemonStatusService {
  private readonly deps: DaemonStatusServiceDeps;
  private readonly sampler: DaemonStatusSampler;
  private readonly startedAt: number;
  private readonly startMonotonic: number;
  private readonly subscribers = new Set<Session>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private histogram: EventLoopHistogram | null = null;
  private lastCpu: CpuBaseline | null = null;

  constructor(deps: DaemonStatusServiceDeps) {
    this.deps = deps;
    this.sampler = deps.sampler ?? systemSampler;
    // Process-level start captured at construction (bootstrap start); a daemon restart resets it.
    this.startedAt = this.sampler.wallNow();
    this.startMonotonic = this.sampler.now();
  }

  /** Build a snapshot. Advances the CPU baseline and resets the lag window. */
  snapshot(): DaemonStatus {
    const now = this.sampler.now();
    const cpu = this.sampler.cpuUsage();
    const micros = cpu.user + cpu.system;
    const last = this.lastCpu;
    const elapsedMicros = last ? (now - last.atMs) * 1000 : 0;
    const cpuPercent =
      last && elapsedMicros > 0 ? ((micros - last.micros) / elapsedMicros) * 100 : 0;
    this.lastCpu = { micros, atMs: now };

    const meanNs = this.histogram?.mean ?? 0;
    const eventLoopLagMs = Number.isFinite(meanNs) && meanNs > 0 ? meanNs / 1e6 : 0;
    this.histogram?.reset();

    const agentsByStatus: Record<string, number> = {};
    for (const agent of this.deps.listAgents()) {
      const status = agent.record.lastStatus;
      agentsByStatus[status] = (agentsByStatus[status] ?? 0) + 1;
    }

    const mem = this.sampler.memoryUsage();
    return {
      version: SERVER_VERSION,
      startedAt: this.startedAt,
      uptimeMs: Math.max(0, now - this.startMonotonic),
      pid: process.pid,
      nodeVersion: process.version,
      memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
      cpuPercent,
      eventLoopLagMs,
      agentsByStatus,
      clients: this.deps.getActiveSessions().map(toClientInfo).toSorted(compareClients),
    };
  }

  /**
   * One-shot status. Without subscribers no sampling runs, so `cpuPercent` and `eventLoopLagMs`
   * are 0 (no window to measure): use `subscribe` for live gauges.
   */
  oneShot(): DaemonStatus {
    if (this.timer !== null) return this.snapshot();
    this.startSampling(false);
    try {
      return this.snapshot();
    } finally {
      this.stopSampling();
    }
  }

  /** Idempotent per session; always returns a fresh snapshot. */
  subscribe(session: Session): DaemonStatusSubscribeResult {
    this.subscribers.add(session);
    if (this.timer === null) this.startSampling(true);
    this.deps.logger?.debug({ clientId: session.clientId }, "daemon status subscribed");
    return { ok: true, intervalMs: DAEMON_STATUS_INTERVAL_MS, status: this.snapshot() };
  }

  unsubscribe(session: Session): void {
    if (!this.subscribers.delete(session)) return;
    this.deps.logger?.debug({ clientId: session.clientId }, "daemon status unsubscribed");
    if (this.subscribers.size === 0) this.stopSampling();
  }

  /** `SessionSubscriptions` disposer: same as unsubscribe, safe when not subscribed. */
  disposeSession(session: Session): void {
    this.unsubscribe(session);
  }

  /** Release the timer and histogram (daemon shutdown). */
  dispose(): void {
    this.subscribers.clear();
    this.stopSampling();
  }

  private startSampling(withTimer: boolean): void {
    const histogram = this.sampler.createEventLoopHistogram();
    histogram.enable();
    this.histogram = histogram;
    // Baseline so the first snapshot after this point has a window to measure against.
    const cpu = this.sampler.cpuUsage();
    this.lastCpu = { micros: cpu.user + cpu.system, atMs: this.sampler.now() };
    if (!withTimer) return;
    this.timer = setInterval(() => this.tick(), DAEMON_STATUS_INTERVAL_MS);
    this.timer.unref();
  }

  private stopSampling(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.histogram?.disable();
    this.histogram = null;
    this.lastCpu = null;
  }

  private tick(): void {
    if (this.subscribers.size === 0) {
      this.stopSampling();
      return;
    }
    const envelope = {
      type: "session",
      message: { type: "daemon_status_update", payload: this.snapshot() },
    };
    for (const session of this.subscribers) {
      try {
        this.deps.send(session, envelope);
      } catch {
        // Dead socket: drop only this subscriber; its close path also cleans up.
        this.unsubscribe(session);
      }
    }
  }
}
