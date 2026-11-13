import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SERVER_VERSION } from "../version.js";
import type { Session } from "../ws/session.js";
import {
  DAEMON_STATUS_INTERVAL_MS,
  DaemonStatusService,
  systemSampler,
  type DaemonStatusSampler,
  type EventLoopHistogram,
} from "./daemon-status-service.js";

function fakeSession(
  clientId: string,
  opts: Partial<Pick<Session, "connectedAt" | "appVersion" | "remoteAddress" | "transport">> = {},
): Session {
  return {
    clientId,
    clientType: "web",
    connectedAt: 1000,
    transport: "direct",
    ...opts,
  } as unknown as Session;
}

interface FakeSampler extends DaemonStatusSampler {
  cpuCalls: number;
  memCalls: number;
  clock: number;
  cpu: number;
  histograms: Array<EventLoopHistogram & { enabled: boolean; mean: number }>;
}

function makeSampler(): FakeSampler {
  const sampler: FakeSampler = {
    cpuCalls: 0,
    memCalls: 0,
    clock: 0,
    cpu: 0,
    histograms: [],
    cpuUsage() {
      sampler.cpuCalls++;
      return { user: sampler.cpu, system: 0 };
    },
    memoryUsage() {
      sampler.memCalls++;
      return { rss: 100, heapUsed: 50, heapTotal: 80 };
    },
    createEventLoopHistogram() {
      const h = {
        enabled: false,
        mean: Number.NaN,
        enable() {
          h.enabled = true;
        },
        disable() {
          h.enabled = false;
        },
        reset() {},
      };
      sampler.histograms.push(h);
      return h;
    },
    now: () => sampler.clock,
    wallNow: () => 1_700_000_000_000,
  };
  return sampler;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("DaemonStatusService", () => {
  it("builds a full snapshot: static facts, agent counts (non-zero keys), sorted clients", () => {
    const sampler = makeSampler();
    const sessions = [
      fakeSession("b", { connectedAt: 2000, transport: "relay" }),
      fakeSession("z", { connectedAt: 1000, appVersion: "dash/1", remoteAddress: "::1" }),
      fakeSession("a", { connectedAt: 1000 }),
    ];
    const svc = new DaemonStatusService({
      listAgents: () => [
        { record: { lastStatus: "idle" } },
        { record: { lastStatus: "idle" } },
        { record: { lastStatus: "running" } },
      ],
      getActiveSessions: () => sessions,
      send: () => {},
      sampler,
    });
    sampler.clock = 250;
    const s = svc.oneShot();
    expect(s.version).toBe(SERVER_VERSION);
    expect(s.pid).toBe(process.pid);
    expect(s.nodeVersion).toBe(process.version);
    expect(s.startedAt).toBe(1_700_000_000_000);
    expect(s.uptimeMs).toBe(250);
    expect(s.memory).toEqual({ rss: 100, heapUsed: 50, heapTotal: 80 });
    expect(s.agentsByStatus).toEqual({ idle: 2, running: 1 });
    expect(s.clients.map((c) => c.clientId)).toEqual(["a", "z", "b"]);
    expect(s.clients[1]).toEqual({
      clientId: "z",
      clientType: "web",
      appVersion: "dash/1",
      connectedAt: 1000,
      remoteAddress: "::1",
      transport: "direct",
    });
    expect(s.clients[0]).not.toHaveProperty("appVersion");
    expect(s.clients[2]).not.toHaveProperty("remoteAddress");
    expect(s.clients[2]!.transport).toBe("relay");
  });

  it("zero agents yields an empty agentsByStatus", () => {
    const svc = new DaemonStatusService({
      listAgents: () => [],
      getActiveSessions: () => [],
      send: () => {},
      sampler: makeSampler(),
    });
    expect(svc.snapshot().agentsByStatus).toEqual({});
  });

  it("one-shot leaves no timer and no enabled histogram", () => {
    const sampler = makeSampler();
    const svc = new DaemonStatusService({
      listAgents: () => [],
      getActiveSessions: () => [],
      send: () => {},
      sampler,
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(sampler.histograms).toHaveLength(0);
    svc.oneShot();
    expect(vi.getTimerCount()).toBe(0);
    expect(sampler.histograms.every((h) => !h.enabled)).toBe(true);
  });

  it("pushes exactly one update per 5 s to subscribers only", () => {
    const sampler = makeSampler();
    const sent: Array<{ to: string; envelope: unknown }> = [];
    const a = fakeSession("A");
    const b = fakeSession("B");
    const svc = new DaemonStatusService({
      listAgents: () => [],
      getActiveSessions: () => [a, b],
      send: (s, envelope) => sent.push({ to: s.clientId, envelope }),
      sampler,
    });
    const res = svc.subscribe(a);
    expect(res.ok).toBe(true);
    expect(res.intervalMs).toBe(DAEMON_STATUS_INTERVAL_MS);
    expect(res.status.clients).toHaveLength(2);
    vi.advanceTimersByTime(DAEMON_STATUS_INTERVAL_MS * 3);
    expect(sent).toHaveLength(3);
    expect(sent.every((m) => m.to === "A")).toBe(true);
    expect(sent[0]!.envelope).toMatchObject({
      type: "session",
      message: { type: "daemon_status_update", payload: { version: SERVER_VERSION } },
    });
  });

  it("subscribing twice is idempotent (one timer, one update per tick)", () => {
    const sampler = makeSampler();
    const sent: string[] = [];
    const a = fakeSession("A");
    const svc = new DaemonStatusService({
      listAgents: () => [],
      getActiveSessions: () => [a],
      send: (s) => sent.push(s.clientId),
      sampler,
    });
    svc.subscribe(a);
    const again = svc.subscribe(a);
    expect(again.ok).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    expect(sampler.histograms).toHaveLength(1);
    vi.advanceTimersByTime(DAEMON_STATUS_INTERVAL_MS);
    expect(sent).toEqual(["A"]);
  });

  it("last unsubscribe/dispose stops the timer and disables the histogram", () => {
    const sampler = makeSampler();
    const a = fakeSession("A");
    const b = fakeSession("B");
    const svc = new DaemonStatusService({
      listAgents: () => [],
      getActiveSessions: () => [],
      send: () => {},
      sampler,
    });
    svc.subscribe(a);
    svc.subscribe(b);
    svc.unsubscribe(a);
    expect(vi.getTimerCount()).toBe(1);
    expect(sampler.histograms[0]!.enabled).toBe(true);
    svc.disposeSession(b);
    expect(vi.getTimerCount()).toBe(0);
    expect(sampler.histograms[0]!.enabled).toBe(false);
    svc.disposeSession(b); // safe twice
  });

  it("one tick samples cpu and memory once and sends N frames", () => {
    const sampler = makeSampler();
    const sessions = [fakeSession("A"), fakeSession("B"), fakeSession("C")];
    let sends = 0;
    const svc = new DaemonStatusService({
      listAgents: () => [],
      getActiveSessions: () => sessions,
      send: () => void sends++,
      sampler,
    });
    for (const s of sessions) svc.subscribe(s);
    sampler.cpuCalls = 0;
    sampler.memCalls = 0;
    vi.advanceTimersByTime(DAEMON_STATUS_INTERVAL_MS);
    expect(sampler.cpuCalls).toBe(1);
    expect(sampler.memCalls).toBe(1);
    expect(sends).toBe(3);
  });

  it("a throwing send drops only that subscriber", () => {
    const sampler = makeSampler();
    const bad = fakeSession("bad");
    const good = fakeSession("good");
    const got: string[] = [];
    const svc = new DaemonStatusService({
      listAgents: () => [],
      getActiveSessions: () => [],
      send: (s) => {
        if (s === bad) throw new Error("socket closed");
        got.push(s.clientId);
      },
      sampler,
    });
    svc.subscribe(bad);
    svc.subscribe(good);
    vi.advanceTimersByTime(DAEMON_STATUS_INTERVAL_MS * 2);
    expect(got).toEqual(["good", "good"]);
    svc.unsubscribe(good);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cpuPercent follows the delta formula; first sample is 0; lag NaN maps to 0", () => {
    const sampler = makeSampler();
    const svc = new DaemonStatusService({
      listAgents: () => [],
      getActiveSessions: () => [],
      send: () => {},
      sampler,
    });
    const first = svc.subscribe(fakeSession("A")).status;
    expect(first.cpuPercent).toBe(0);
    expect(first.eventLoopLagMs).toBe(0);
    // 5 s window, 2.5 s of CPU => 50 %.
    sampler.clock += 5000;
    sampler.cpu += 2_500_000;
    sampler.histograms[0]!.mean = 4_000_000; // 4 ms in ns
    const next = svc.snapshot();
    expect(next.cpuPercent).toBeCloseTo(50, 10);
    expect(next.eventLoopLagMs).toBe(4);
  });

  it("cost budget: 10 subscribers, 500 agents, 60 s of ticks stays under 1% of one core", () => {
    const sessions = Array.from({ length: 10 }, (_, i) => fakeSession(`c${i}`, { connectedAt: i }));
    const agents = Array.from({ length: 500 }, (_, i) => ({
      record: { lastStatus: i % 3 === 0 ? "running" : "idle" },
    }));
    const svc = new DaemonStatusService({
      listAgents: () => agents,
      getActiveSessions: () => sessions,
      send: (_s, envelope) => void JSON.stringify(envelope),
      sampler: systemSampler,
    });
    for (const s of sessions) svc.subscribe(s);
    const t0 = performance.now();
    vi.advanceTimersByTime(60_000);
    const busyMs = performance.now() - t0;
    const percentOfCore = (busyMs / 60_000) * 100;
    console.log(
      `daemon status cost: ${busyMs.toFixed(2)} ms over 60 s = ${percentOfCore.toFixed(4)} %`,
    );
    expect(percentOfCore).toBeLessThan(1);
    svc.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
