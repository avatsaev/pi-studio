import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiStudioClient } from "@av-pi-studio/client";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useSessionStore, type SessionEntry } from "@pi-studio-ui/stores/session-store.js";
import { useStatsStore } from "@pi-studio-ui/stores/stats-store.js";
import { applyStreamEvent, EMPTY_TIMELINE } from "@pi-studio-ui/timeline/reducer.js";
import { useCompactionStore } from "./compaction-store.js";

interface Fake {
  compact: ReturnType<typeof vi.fn>;
  interrupt: ReturnType<typeof vi.fn>;
}

function install(opts: { compactionEvents: boolean; compact?: Fake["compact"] }): Fake {
  const fake: Fake = {
    compact:
      opts.compact ??
      vi
        .fn()
        .mockResolvedValue({ summary: "s", tokensBefore: 168_000, estimatedTokensAfter: 14_000 }),
    interrupt: vi.fn().mockResolvedValue(undefined),
  };
  useConnectionStore.setState({
    status: "open",
    client: { agent: () => fake } as unknown as PiStudioClient,
    serverInfo: { features: opts.compactionEvents ? { compactionEvents: true } : {} } as never,
  });
  return fake;
}

function session(over: Partial<SessionEntry> = {}): SessionEntry {
  return {
    id: "s1",
    agentId: "a1",
    title: "t",
    status: "idle",
    cwd: "/w",
    timeline: EMPTY_TIMELINE,
    userMessageCount: 0,
    ...over,
  };
}

beforeEach(() => {
  useCompactionStore.setState({ pendingBySession: {}, lastErrorBySession: {} });
  useStatsStore.setState({ bySession: {} });
  useSessionStore.setState({ sessions: { s1: session() }, order: ["s1"], activeSessionId: "s1" });
});

describe("compactSession preconditions", () => {
  it("refuses without sending when disconnected, agentless, running, or already compacting", async () => {
    const fake = install({ compactionEvents: true });
    const store = useCompactionStore.getState();

    useConnectionStore.setState({ status: "closed" });
    expect(await store.compactSession("s1")).toEqual({ ok: false, reason: "disconnected" });
    useConnectionStore.setState({ status: "open" });

    useSessionStore.setState({ sessions: { s1: session({ agentId: null }) } });
    expect(await store.compactSession("s1")).toEqual({ ok: false, reason: "no-agent" });

    useSessionStore.setState({ sessions: { s1: session({ status: "running" }) } });
    expect(await store.compactSession("s1")).toEqual({ ok: false, reason: "running" });

    const started = applyStreamEvent(EMPTY_TIMELINE, {
      kind: "compaction",
      compactionId: "c1",
      phase: "started",
    });
    useSessionStore.setState({ sessions: { s1: session({ timeline: started }) } });
    expect(await store.compactSession("s1")).toEqual({ ok: false, reason: "compacting" });

    expect(fake.compact).not.toHaveBeenCalled();
  });

  it("a second call while the first RPC is in flight is refused; only one request is sent", async () => {
    let release!: (v: unknown) => void;
    const fake = install({
      compactionEvents: true,
      compact: vi.fn().mockReturnValue(new Promise((r) => (release = r))),
    });
    const first = useCompactionStore.getState().compactSession("s1", "focus");
    expect(useCompactionStore.getState().pendingBySession["s1"]).toBe(true);
    expect(await useCompactionStore.getState().compactSession("s1")).toEqual({
      ok: false,
      reason: "compacting",
    });
    release({ summary: "s", tokensBefore: 1 });
    expect(await first).toEqual({ ok: true });
    expect(fake.compact).toHaveBeenCalledTimes(1);
    expect(fake.compact).toHaveBeenCalledWith("focus");
  });
});

describe("compactSession outcome", () => {
  it("clears pending on success", async () => {
    install({ compactionEvents: true });
    await useCompactionStore.getState().compactSession("s1");
    expect(useCompactionStore.getState().pendingBySession).toEqual({});
  });

  it("clears pending on failure and stores the daemon's message verbatim", async () => {
    install({
      compactionEvents: true,
      compact: vi.fn().mockRejectedValue(new Error("Nothing to compact (session too small)")),
    });
    const result = await useCompactionStore.getState().compactSession("s1");
    expect(result).toEqual({
      ok: false,
      reason: "failed",
      message: "Nothing to compact (session too small)",
    });
    expect(useCompactionStore.getState().pendingBySession).toEqual({});
    expect(useCompactionStore.getState().lastErrorBySession["s1"]).toBe(
      "Nothing to compact (session too small)",
    );
  });

  it("a new attempt clears the previous error", async () => {
    useCompactionStore.setState({ lastErrorBySession: { s1: "old" } });
    install({ compactionEvents: true });
    await useCompactionStore.getState().compactSession("s1");
    expect(useCompactionStore.getState().lastErrorBySession).toEqual({});
  });

  it("without compactionEvents, the response's estimate is written to stats", async () => {
    useStatsStore.getState().setStats("s1", { contextWindow: 200_000, contextPercent: 84 });
    install({ compactionEvents: false });
    await useCompactionStore.getState().compactSession("s1");
    expect(useStatsStore.getState().bySession["s1"]).toMatchObject({
      contextTokens: 14_000,
      contextPercent: 7,
      contextEstimated: true,
    });
  });

  it("with compactionEvents, the response does not write stats (the live event already did)", async () => {
    install({ compactionEvents: true });
    await useCompactionStore.getState().compactSession("s1");
    expect(useStatsStore.getState().bySession["s1"]).toBeUndefined();
  });
});

describe("cancelCompaction", () => {
  it("interrupts the session's agent", async () => {
    const fake = install({ compactionEvents: true });
    await useCompactionStore.getState().cancelCompaction("s1");
    expect(fake.interrupt).toHaveBeenCalledTimes(1);
  });

  it("turns the rejection Pi raises after an abort into `canceled`, with no inline error", async () => {
    let reject!: (e: Error) => void;
    const fake = install({
      compactionEvents: true,
      compact: vi.fn().mockReturnValue(new Promise((_, r) => (reject = r))),
    });
    const running = useCompactionStore.getState().compactSession("s1");
    await useCompactionStore.getState().cancelCompaction("s1");
    expect(fake.interrupt).toHaveBeenCalledTimes(1);
    reject(new Error("Turn prefix summarization failed: This operation was aborted"));
    expect(await running).toEqual({ ok: false, reason: "canceled" });
    expect(useCompactionStore.getState().lastErrorBySession).toEqual({});
    expect(useCompactionStore.getState().pendingBySession).toEqual({});
  });

  it("does not let a cancel with nothing in flight reclassify the next real failure", async () => {
    install({ compactionEvents: true, compact: vi.fn().mockRejectedValue(new Error("boom")) });
    await useCompactionStore.getState().cancelCompaction("s1");
    expect(await useCompactionStore.getState().compactSession("s1")).toEqual({
      ok: false,
      reason: "failed",
      message: "boom",
    });
  });
});
