import type { DaemonClient } from "./daemon-client.js";

/**
 * Reconnection + capability-rehydrate driver (architecture/client-app-runtime.md § Connection,
 * § Error Handling; architecture/websocket-protocol.md § Behavior / on reconnect).
 *
 * On socket drop, backoff-reconnect, re-`hello` (the `DaemonClient.connect()` resends the same
 * capabilities), and rehydrate the recorded `serverId`/`features`. Timeline resume planning lives
 * in sprint-012; this driver exposes the hooks (`onReconnected`) the planner rides on.
 *
 * Reconnection backoff parameters are TODO(verify) — defaults below are conservative.
 */

export interface ReconnectionOptions {
  /** Initial backoff delay (ms). Default 500. */
  initialDelayMs?: number;
  /** Maximum backoff delay (ms). Default 30_000. */
  maxDelayMs?: number;
  /** Exponential growth factor. Default 2. */
  factor?: number;
  /** Random jitter ratio [0..1] applied to each delay. Default 0.2. */
  jitter?: number;
  /** Max reconnect attempts before giving up (Infinity = never). Default Infinity. */
  maxAttempts?: number;
  /** Injected timer scheduler (tests). Defaults to setTimeout. */
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Injected RNG in [0,1) (tests). Defaults to Math.random. */
  random?: () => number;
}

export type ReconnectedHandler = (info: { attempt: number; serverId: string | null }) => void;
export type ReconnectFailedHandler = (error: unknown, attempt: number) => void;

export class ReconnectionManager {
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly factor: number;
  private readonly jitter: number;
  private readonly maxAttempts: number;
  private readonly setTimer: (cb: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly random: () => number;

  private attempt = 0;
  private timer: unknown = null;
  private active = false;
  private reconnecting = false;
  private detachState: (() => void) | null = null;

  private readonly reconnectedHandlers = new Set<ReconnectedHandler>();
  private readonly failedHandlers = new Set<ReconnectFailedHandler>();

  constructor(
    private readonly daemon: DaemonClient,
    options: ReconnectionOptions = {},
  ) {
    this.initialDelayMs = options.initialDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.factor = options.factor ?? 2;
    this.jitter = options.jitter ?? 0.2;
    this.maxAttempts = options.maxAttempts ?? Number.POSITIVE_INFINITY;
    this.setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimer =
      options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.random = options.random ?? Math.random;
  }

  /** Compute the backoff delay for a given attempt number (1-based), with jitter. */
  delayForAttempt(attempt: number): number {
    const base = Math.min(this.maxDelayMs, this.initialDelayMs * this.factor ** (attempt - 1));
    const jitterAmount = base * this.jitter * (this.random() * 2 - 1);
    return Math.max(0, Math.round(base + jitterAmount));
  }

  /** Subscribe to successful reconnections (after re-handshake + rehydrate). */
  onReconnected(handler: ReconnectedHandler): () => void {
    this.reconnectedHandlers.add(handler);
    return () => this.reconnectedHandlers.delete(handler);
  }

  /** Subscribe to reconnect attempt failures. */
  onReconnectFailed(handler: ReconnectFailedHandler): () => void {
    this.failedHandlers.add(handler);
    return () => this.failedHandlers.delete(handler);
  }

  /**
   * Start watching the daemon connection. On a `closed` transition, schedule a backoff reconnect.
   */
  start(): void {
    if (this.active) return;
    this.active = true;
    this.detachState = this.daemon.onStateChange((state) => {
      if (state === "closed" && this.active) this.scheduleReconnect();
      if (state === "open") this.attempt = 0; // reset backoff on a healthy connection
    });
  }

  /** Stop watching and cancel any pending reconnect. */
  stop(): void {
    this.active = false;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.detachState?.();
    this.detachState = null;
  }

  /**
   * Cancel any pending backoff timer and attempt a reconnect immediately, resetting the backoff
   * ladder. No-op unless the manager is active and the daemon is `closed`; no-op while an attempt
   * is already in flight.
   *
   * `attempt: 0` is the forced-reconnect signal: a successful forced reconnect notifies
   * `onReconnected` with `{ attempt: 0, serverId }`, distinguishing it from ladder attempts
   * (always ≥ 1). A forced attempt that fails still falls back to `scheduleReconnect()`'s normal
   * failure path, which restarts the ladder at rung 1 — the correct aggression level for a user
   * who just triggered this via a fresh external signal (tab visible, network online).
   */
  reconnectNow(): void {
    if (!this.active) return;
    if (this.reconnecting) return;
    if (this.daemon.state !== "closed") return;
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.attempt = 0;
    void this.tryReconnect();
  }

  /** Number of reconnect attempts made since the last healthy open. */
  get attemptCount(): number {
    return this.attempt;
  }

  private scheduleReconnect(): void {
    if (!this.active) return;
    if (this.timer) return; // already armed — see reconnectNow()'s docstring for why this must be unique
    if (this.attempt >= this.maxAttempts) return;
    this.attempt += 1;
    const delay = this.delayForAttempt(this.attempt);
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (this.reconnecting) return;
      void this.tryReconnect();
    }, delay);
  }

  private async tryReconnect(): Promise<void> {
    if (!this.active) return;
    if (this.reconnecting) return;
    this.reconnecting = true;
    const attempt = this.attempt;
    try {
      // connect() re-sends hello with the same capabilities → daemon rehydrates them, and the
      // client re-records serverId + features from the fresh server_info.
      await this.daemon.connect();
      for (const handler of this.reconnectedHandlers) {
        handler({ attempt, serverId: this.daemon.serverId });
      }
    } catch (error) {
      for (const handler of this.failedHandlers) handler(error, attempt);
      this.scheduleReconnect(); // back off and retry
    } finally {
      this.reconnecting = false;
    }
  }
}
