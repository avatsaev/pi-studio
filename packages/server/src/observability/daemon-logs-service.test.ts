import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LogTap } from "../logging/log-tap.js";
import { createLogger, type Logger } from "../logging/logger.js";
import type { Session } from "../ws/session.js";
import { DaemonLogsService } from "./daemon-logs-service.js";

interface Pushed {
  lines: Array<{ msg: string; level: string }>;
  dropped: number;
}

const fakeSession = (clientId: string): Session => ({ clientId }) as unknown as Session;

function setup(level: "debug" | "info" | "warn" = "debug") {
  const tap = new LogTap();
  const log: Logger = createLogger({
    level,
    pretty: false,
    stdoutStream: { write: () => true } as unknown as NodeJS.WritableStream,
    tap,
  });
  const pushes = new Map<Session, Pushed[]>();
  const failing = new Set<Session>();
  let clock = 0;
  const service = new DaemonLogsService({
    tap,
    now: () => clock,
    send: (session, envelope) => {
      if (failing.has(session)) throw new Error("socket closed");
      const message = (envelope as { message: { type: string } & Pushed }).message;
      expect(message.type).toBe("daemon_log_lines");
      const list = pushes.get(session) ?? [];
      list.push({ lines: message.lines, dropped: message.dropped });
      pushes.set(session, list);
    },
  });
  return {
    tap,
    log,
    service,
    pushes,
    failing,
    advance: (ms: number) => {
      clock += ms;
      vi.advanceTimersByTime(ms);
    },
    delivered: (s: Session) => (pushes.get(s) ?? []).flatMap((p) => p.lines),
    dropped: (s: Session) => (pushes.get(s) ?? []).reduce((n, p) => n + p.dropped, 0),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("DaemonLogsService", () => {
  it("caps a 1000-line burst at 200 delivered and reports the remainder as dropped", () => {
    const t = setup();
    const s = fakeSession("a");
    t.service.subscribe(s, "info");
    for (let i = 0; i < 1000; i++) t.log.info(`m${i}`);
    t.advance(100);
    expect(t.delivered(s)).toHaveLength(200);
    expect(t.delivered(s)[0]!.msg).toBe("m0");
    expect(t.dropped(s)).toBe(800);
    t.advance(1000);
    expect(t.delivered(s).length).toBeLessThanOrEqual(200);
    expect(t.delivered(s).length + t.dropped(s)).toBe(1000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sends a trailing empty push carrying dropped when the burst ends in drops", () => {
    const t = setup();
    const s = fakeSession("a");
    t.service.subscribe(s, "info");
    for (let i = 0; i < 200; i++) t.log.info("fill");
    // Timers only: the monotonic clock stays put so the bucket is still empty.
    vi.advanceTimersByTime(100);
    for (let i = 0; i < 5; i++) t.log.info("over");
    vi.advanceTimersByTime(100);
    const all = t.pushes.get(s)!;
    expect(all.at(-1)).toEqual({ lines: [], dropped: 5 });
    expect(t.delivered(s)).toHaveLength(200);
    expect(t.dropped(s)).toBe(5);
  });

  it("gives a second subscriber its own full quota while the first is dropping", () => {
    const t = setup();
    const a = fakeSession("a");
    t.service.subscribe(a, "info");
    for (let i = 0; i < 300; i++) t.log.info("pre");
    t.advance(100);
    const b = fakeSession("b");
    t.service.subscribe(b, "info");
    for (let i = 0; i < 200; i++) t.log.info("post");
    t.advance(100);
    expect(t.delivered(b)).toHaveLength(200);
    expect(t.dropped(b)).toBe(0);
    expect(t.dropped(a)).toBeGreaterThan(0);
  });

  it("filters by minLevel and re-subscribing replaces the level", () => {
    const t = setup();
    const s = fakeSession("a");
    t.service.subscribe(s, "warn");
    t.log.info("i");
    t.log.debug("d");
    t.log.warn("w");
    t.log.error("e");
    t.advance(100);
    expect(t.delivered(s).map((l) => l.msg)).toEqual(["w", "e"]);
    t.service.subscribe(s, "info");
    t.log.info("i2");
    t.advance(100);
    expect(t.delivered(s).map((l) => l.msg)).toEqual(["w", "e", "i2"]);
  });

  it("clamps to the daemon level and reports silent for an unattached tap", () => {
    const t = setup("info");
    const s = fakeSession("a");
    const res = t.service.subscribe(s, "debug");
    expect(res).toMatchObject({ ok: true, minLevel: "debug", effectiveLevel: "info", dropped: 0 });
    t.log.debug("never written");
    t.log.info("seen");
    t.advance(100);
    expect(t.delivered(s).map((l) => l.msg)).toEqual(["seen"]);
    expect(t.service.subscribe(s, "error")).toMatchObject({ effectiveLevel: "error" });

    const bare = new DaemonLogsService({ tap: new LogTap(), send: () => {} });
    expect(bare.subscribe(s, "info")).toEqual({
      ok: true,
      minLevel: "info",
      effectiveLevel: "silent",
      lines: [],
      dropped: 0,
    });
  });

  it("returns the tail backlog oldest first, filtered by level", () => {
    const t = setup();
    for (let i = 0; i < 10; i++) (i % 2 ? t.log.warn : t.log.info).call(t.log, `m${i}`);
    const res = t.service.subscribe(fakeSession("a"), "warn", 3);
    expect(res.ok && res.lines.map((l) => l.msg)).toEqual(["m5", "m7", "m9"]);
    const none = t.service.subscribe(fakeSession("b"), "info");
    expect(none.ok && none.lines).toEqual([]);
  });

  it("rejects invalid input and keeps the previous subscription active", () => {
    const t = setup();
    const s = fakeSession("a");
    t.service.subscribe(s, "info");
    for (const tail of [1001, -1, 1.5, "5", Number.NaN]) {
      expect(t.service.subscribe(s, "info", tail)).toEqual({ ok: false, error: "invalid_tail" });
    }
    expect(t.service.subscribe(s, "loud")).toEqual({ ok: false, error: "invalid_level" });
    expect(t.service.subscribe(s, undefined)).toEqual({ ok: false, error: "invalid_level" });
    expect(t.service.subscribe(s, "toString")).toEqual({ ok: false, error: "invalid_level" });
    t.log.info("still here");
    t.advance(100);
    expect(t.delivered(s).map((l) => l.msg)).toEqual(["still here"]);
  });

  it("stops pushes and timers after unsubscribe, dispose, or send failure", () => {
    const t = setup();
    const a = fakeSession("a");
    const b = fakeSession("b");
    const c = fakeSession("c");
    t.service.subscribe(a, "info");
    t.service.subscribe(b, "info");
    t.service.subscribe(c, "info");
    t.log.info("one");
    expect(vi.getTimerCount()).toBe(3);
    t.service.unsubscribe(a);
    t.service.unsubscribe(a);
    t.service.disposeSession(b);
    expect(vi.getTimerCount()).toBe(1);
    t.failing.add(c);
    t.advance(100);
    expect(t.pushes.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    t.log.info("two");
    expect(vi.getTimerCount()).toBe(0);
    expect(t.pushes.size).toBe(0);
  });

  it("keeps other subscribers working when one leaves, and idle means no timer", () => {
    const t = setup();
    const a = fakeSession("a");
    const b = fakeSession("b");
    t.service.subscribe(a, "info");
    t.service.subscribe(b, "info");
    t.service.unsubscribe(a);
    t.log.info("x");
    t.advance(100);
    expect(t.delivered(b)).toHaveLength(1);
    expect(t.delivered(a)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    t.service.dispose();
    t.log.info("y");
    expect(vi.getTimerCount()).toBe(0);
  });
});
