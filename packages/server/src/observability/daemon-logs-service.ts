import { performance } from "node:perf_hooks";

import type { LogLine } from "@av-pi-studio/protocol";

import { LOG_LEVEL_NUMBERS, type LogTap } from "../logging/log-tap.js";
import type { LogLevel } from "../logging/logger.js";
import type { Session } from "../ws/session.js";

/**
 * Per-session daemon log delivery (swe/features/daemon-log-streaming.md § Subscribe / deliver /
 * cap). Each subscriber owns a level filter, a 200 lines/s token bucket (burst 200), a queue and a
 * 100 ms flush timer that exists only while that subscriber has pending data. Overflow lines are
 * counted in `dropped` (incremental, per subscriber) and never re-delivered. The ring and the log
 * files are never subject to the cap.
 */

export const LOG_RATE_PER_SECOND = 200;
export const LOG_FLUSH_INTERVAL_MS = 100;
export const LOG_TAIL_MAX = 1000;

export type DaemonLogLevelName = Exclude<LogLevel, "silent">;

export interface DaemonLogsTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemTimers: DaemonLogsTimers = {
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    handle.unref();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface DaemonLogsServiceDeps {
  tap: LogTap;
  /** Delivers one `{type:"session", message}` envelope to a session. May throw. */
  send(session: Session, envelope: unknown): void;
  /** Monotonic milliseconds. Defaults to `performance.now`. */
  now?: () => number;
  timers?: DaemonLogsTimers;
}

export type DaemonLogsSubscribeResult =
  | {
      ok: true;
      minLevel: DaemonLogLevelName;
      effectiveLevel: LogLevel;
      lines: LogLine[];
      dropped: 0;
    }
  | { ok: false; error: "invalid_level" | "invalid_tail" };

interface Subscription {
  readonly session: Session;
  readonly minLevelNum: number;
  queue: string[];
  tokens: number;
  refilledAt: number;
  droppedSinceLastPush: number;
  timer: unknown;
}

const isLevelName = (v: unknown): v is DaemonLogLevelName =>
  typeof v === "string" && Object.hasOwn(LOG_LEVEL_NUMBERS, v);

export class DaemonLogsService {
  private readonly tap: LogTap;
  private readonly send: (session: Session, envelope: unknown) => void;
  private readonly now: () => number;
  private readonly timers: DaemonLogsTimers;
  private readonly subs = new Map<Session, Subscription>();
  private removeListener: (() => void) | null = null;

  constructor(deps: DaemonLogsServiceDeps) {
    this.tap = deps.tap;
    this.send = deps.send;
    this.now = deps.now ?? (() => performance.now());
    this.timers = deps.timers ?? systemTimers;
  }

  /**
   * Validates, then REPLACES any existing subscription for the session (fresh limiter). An invalid
   * request leaves the previous subscription untouched.
   */
  subscribe(session: Session, minLevel: unknown, tail?: unknown): DaemonLogsSubscribeResult {
    if (!isLevelName(minLevel)) return { ok: false, error: "invalid_level" };
    const tailCount = tail === undefined ? 0 : tail;
    if (
      typeof tailCount !== "number" ||
      !Number.isInteger(tailCount) ||
      tailCount < 0 ||
      tailCount > LOG_TAIL_MAX
    ) {
      return { ok: false, error: "invalid_tail" };
    }

    this.clearSubscription(session);
    const minLevelNum = LOG_LEVEL_NUMBERS[minLevel];
    this.subs.set(session, {
      session,
      minLevelNum,
      queue: [],
      tokens: LOG_RATE_PER_SECOND,
      refilledAt: this.now(),
      droppedSinceLastPush: 0,
      timer: null,
    });
    this.ensureListening();

    const lines =
      tailCount > 0
        ? this.tap.backlog(minLevelNum, tailCount).map((raw) => this.tap.toLogLine(raw))
        : [];
    return {
      ok: true,
      minLevel,
      effectiveLevel: this.effectiveLevel(minLevel),
      lines,
      dropped: 0,
    };
  }

  /** Idempotent. */
  unsubscribe(session: Session): void {
    this.clearSubscription(session);
    this.stopListeningIfIdle();
  }

  /** `SessionSubscriptions` disposer; safe when not subscribed. */
  disposeSession(session: Session): void {
    this.unsubscribe(session);
  }

  /** Release every subscription, timer and tap listener (daemon shutdown). */
  dispose(): void {
    for (const session of this.subs.keys()) this.clearSubscription(session);
    this.stopListeningIfIdle();
  }

  /** The stricter of the daemon's level and `minLevel`; `"silent"` when the tap is unattached. */
  private effectiveLevel(minLevel: DaemonLogLevelName): LogLevel {
    const daemonLevel = this.tap.effectiveLevel;
    if (daemonLevel === "silent") return "silent";
    return LOG_LEVEL_NUMBERS[daemonLevel] > LOG_LEVEL_NUMBERS[minLevel] ? daemonLevel : minLevel;
  }

  private ensureListening(): void {
    this.removeListener ??= this.tap.onLine((raw, levelNum) => this.onLine(raw, levelNum));
  }

  private stopListeningIfIdle(): void {
    if (this.subs.size > 0 || this.removeListener === null) return;
    this.removeListener();
    this.removeListener = null;
  }

  private clearSubscription(session: Session): void {
    const sub = this.subs.get(session);
    if (!sub) return;
    if (sub.timer !== null) this.timers.clearTimeout(sub.timer);
    sub.timer = null;
    this.subs.delete(session);
  }

  private onLine(raw: string, levelNum: number): void {
    for (const sub of this.subs.values()) {
      if (levelNum >= sub.minLevelNum) this.enqueue(sub, raw);
    }
  }

  private enqueue(sub: Subscription, raw: string): void {
    const now = this.now();
    const elapsed = Math.max(0, now - sub.refilledAt);
    sub.refilledAt = now;
    sub.tokens = Math.min(LOG_RATE_PER_SECOND, sub.tokens + (elapsed * LOG_RATE_PER_SECOND) / 1000);
    if (sub.tokens >= 1) {
      sub.tokens -= 1;
      sub.queue.push(raw);
    } else {
      sub.droppedSinceLastPush += 1;
    }
    this.scheduleFlush(sub);
  }

  private scheduleFlush(sub: Subscription): void {
    if (sub.timer !== null) return;
    sub.timer = this.timers.setTimeout(() => this.flush(sub), LOG_FLUSH_INTERVAL_MS);
  }

  private flush(sub: Subscription): void {
    sub.timer = null;
    if (this.subs.get(sub.session) !== sub) return;
    if (sub.queue.length === 0 && sub.droppedSinceLastPush === 0) return;
    const batch = sub.queue.splice(0, LOG_RATE_PER_SECOND);
    const dropped = sub.droppedSinceLastPush;
    sub.droppedSinceLastPush = 0;
    try {
      this.send(sub.session, {
        type: "session",
        message: {
          type: "daemon_log_lines",
          lines: batch.map((raw) => this.tap.toLogLine(raw)),
          dropped,
        },
      });
    } catch {
      // Dead socket: remove only this subscriber; its close path also disposes.
      this.unsubscribe(sub.session);
      return;
    }
    if (sub.queue.length > 0) this.scheduleFlush(sub);
  }
}
