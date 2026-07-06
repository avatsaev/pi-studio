/**
 * Session store tests — sprint-023 / task-001
 *
 * Covers: upsert/remove agents, status transitions, timeline merging,
 * permissions, optimistic messages, workspaces, server info.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "./session-store.js";
import type { AgentPermission, OptimisticMessage } from "./session-store.js";
import { EMPTY_TIMELINE } from "../timeline/reducer.js";

// Reset store state before each test
function resetStore() {
  useSessionStore.setState({
    agents: {},
    workspaces: {},
    servers: {},
    activeServerId: null,
  });
}

describe("SessionStore — agent lifecycle", () => {
  beforeEach(resetStore);

  it("upserts a new agent with defaults", () => {
    const { upsertAgent, agents } = useSessionStore.getState();
    upsertAgent({ agentId: "a1" });
    const a = useSessionStore.getState().agents["a1"];
    expect(a).toBeDefined();
    expect(a?.agentId).toBe("a1");
    expect(a?.status).toBe("initializing");
    expect(a?.labels).toEqual({});
    expect(a?.permissions).toEqual({});
    expect(a?.optimisticMessages).toEqual({});
  });

  it("upserts with provided fields", () => {
    useSessionStore.getState().upsertAgent({
      agentId: "a1",
      status: "idle",
      title: "Test Agent",
      cwd: "/home/user/proj",
      workspaceId: "ws1",
      labels: { env: "dev" },
    });
    const a = useSessionStore.getState().agents["a1"]!;
    expect(a.status).toBe("idle");
    expect(a.title).toBe("Test Agent");
    expect(a.cwd).toBe("/home/user/proj");
    expect(a.workspaceId).toBe("ws1");
    expect(a.labels).toEqual({ env: "dev" });
  });

  it("merges labels on repeated upsert", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1", labels: { a: "1" } });
    useSessionStore.getState().upsertAgent({ agentId: "a1", labels: { b: "2" } });
    const a = useSessionStore.getState().agents["a1"]!;
    expect(a.labels).toEqual({ a: "1", b: "2" });
  });

  it("sets agent status", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1" });
    useSessionStore.getState().setAgentStatus("a1", "running");
    expect(useSessionStore.getState().agents["a1"]?.status).toBe("running");
  });

  it("setAgentStatus is a no-op for unknown agent", () => {
    useSessionStore.getState().setAgentStatus("unknown", "idle");
    expect(useSessionStore.getState().agents["unknown"]).toBeUndefined();
  });

  it("removes an agent", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1" });
    useSessionStore.getState().removeAgent("a1");
    expect(useSessionStore.getState().agents["a1"]).toBeUndefined();
  });

  it("clearAllAgents empties the agents map", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1" });
    useSessionStore.getState().upsertAgent({ agentId: "a2" });
    useSessionStore.getState().clearAllAgents();
    expect(Object.keys(useSessionStore.getState().agents)).toHaveLength(0);
  });
});

describe("SessionStore — timeline", () => {
  beforeEach(resetStore);

  it("applies a stream event as a live row", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1" });
    const event = {
      type: "assistant_message",
      seq: 1,
      rowId: "row1",
      epochId: "epoch1",
      content: "Hello",
    } as never;
    useSessionStore.getState().applyStreamEvent("a1", event);
    const timeline = useSessionStore.getState().agents["a1"]?.timeline!;
    expect(timeline.rows).toHaveLength(1);
    expect(timeline.rows[0]?.kind).toBe("assistant_message");
    expect(timeline.rows[0]?.source).toBe("live");
  });

  it("ignores stream event for unknown agent", () => {
    useSessionStore.getState().applyStreamEvent("unknown", { type: "assistant_message" } as never);
    expect(useSessionStore.getState().agents["unknown"]).toBeUndefined();
  });

  it("merges a page of rows", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1" });
    const page = {
      rows: [
        { rowId: "r1", kind: "user_message" as const, seqStart: 1, seqEnd: 1, source: "page" as const, epochId: "e1", timestamp: 1000, payload: {} },
      ],
      seqStart: 1,
      seqEnd: 1,
      hasNewer: false,
    };
    useSessionStore.getState().mergePage("a1", page);
    const timeline = useSessionStore.getState().agents["a1"]?.timeline!;
    expect(timeline.rows).toHaveLength(1);
    expect(timeline.rows[0]?.source).toBe("page");
  });

  it("resets timeline", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1" });
    const event = { type: "user_message", seq: 1, rowId: "r1" } as never;
    useSessionStore.getState().applyStreamEvent("a1", event);
    useSessionStore.getState().resetTimeline("a1");
    expect(useSessionStore.getState().agents["a1"]?.timeline.rows).toHaveLength(0);
  });

  it("page rows take precedence over live rows in same seq range", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1" });
    // Apply live row at seq 1
    const liveEvent = { type: "user_message", seq: 1, rowId: "r1", epochId: "e1" } as never;
    useSessionStore.getState().applyStreamEvent("a1", liveEvent);
    // Merge page covering seq 1
    const page = {
      rows: [{ rowId: "r1", kind: "user_message" as const, seqStart: 1, seqEnd: 1, source: "page" as const, epochId: "e1", timestamp: 1000, payload: { fromPage: true } }],
      seqStart: 1,
      seqEnd: 1,
      hasNewer: false,
    };
    useSessionStore.getState().mergePage("a1", page);
    const timeline = useSessionStore.getState().agents["a1"]?.timeline!;
    // Only the page row should remain (live deduped)
    const pageRows = timeline.rows.filter((r) => r.source === "page");
    expect(pageRows).toHaveLength(1);
  });
});

describe("SessionStore — permissions", () => {
  beforeEach(resetStore);

  it("adds a pending permission", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1" });
    const perm: AgentPermission = {
      requestId: "req1",
      agentId: "a1",
      toolName: "bash",
      state: "pending",
    };
    useSessionStore.getState().addPermission("a1", perm);
    const perms = useSessionStore.getState().agents["a1"]?.permissions!;
    expect(perms["req1"]?.state).toBe("pending");
    expect(perms["req1"]?.toolName).toBe("bash");
  });

  it("resolves a permission", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1" });
    useSessionStore.getState().addPermission("a1", {
      requestId: "req1",
      agentId: "a1",
      state: "pending",
    });
    useSessionStore.getState().resolvePermission("a1", "req1", "allow");
    const perm = useSessionStore.getState().agents["a1"]?.permissions["req1"]!;
    expect(perm.state).toBe("resolved");
    expect(perm.decision).toBe("allow");
  });

  it("resolvePermission is a no-op for missing permission", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1" });
    // Should not throw
    useSessionStore.getState().resolvePermission("a1", "nonexistent", "allow");
  });
});

describe("SessionStore — optimistic messages", () => {
  beforeEach(resetStore);

  it("adds an optimistic message", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1" });
    const msg: OptimisticMessage = {
      clientMessageId: "cm1",
      text: "Hello daemon",
      timestamp: 1000,
    };
    useSessionStore.getState().addOptimisticMessage("a1", msg);
    const opts = useSessionStore.getState().agents["a1"]?.optimisticMessages!;
    expect(opts["cm1"]?.text).toBe("Hello daemon");
  });

  it("confirms (removes) an optimistic message", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1" });
    useSessionStore.getState().addOptimisticMessage("a1", { clientMessageId: "cm1", text: "x", timestamp: 0 });
    useSessionStore.getState().confirmOptimisticMessage("a1", "cm1");
    expect(useSessionStore.getState().agents["a1"]?.optimisticMessages["cm1"]).toBeUndefined();
  });

  it("rolls back an optimistic message on error", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1" });
    useSessionStore.getState().addOptimisticMessage("a1", { clientMessageId: "cm1", text: "x", timestamp: 0 });
    useSessionStore.getState().rollbackOptimisticMessage("a1", "cm1");
    expect(useSessionStore.getState().agents["a1"]?.optimisticMessages["cm1"]).toBeUndefined();
  });

  it("leaves other messages intact when confirming one", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1" });
    useSessionStore.getState().addOptimisticMessage("a1", { clientMessageId: "cm1", text: "first", timestamp: 0 });
    useSessionStore.getState().addOptimisticMessage("a1", { clientMessageId: "cm2", text: "second", timestamp: 1 });
    useSessionStore.getState().confirmOptimisticMessage("a1", "cm1");
    expect(useSessionStore.getState().agents["a1"]?.optimisticMessages["cm2"]).toBeDefined();
  });
});

describe("SessionStore — workspaces", () => {
  beforeEach(resetStore);

  it("upserts a workspace descriptor", () => {
    useSessionStore.getState().upsertWorkspace({
      workspaceId: "ws1",
      name: "My Workspace",
      cwd: "/home/user/proj",
      agentIds: ["a1"],
    });
    const ws = useSessionStore.getState().workspaces["ws1"]!;
    expect(ws.name).toBe("My Workspace");
    expect(ws.agentIds).toEqual(["a1"]);
  });

  it("removes a workspace", () => {
    useSessionStore.getState().upsertWorkspace({ workspaceId: "ws1", name: "w", agentIds: [] });
    useSessionStore.getState().removeWorkspace("ws1");
    expect(useSessionStore.getState().workspaces["ws1"]).toBeUndefined();
  });
});

describe("SessionStore — streaming deltas", () => {
  beforeEach(resetStore);

  it("accumulates assistant token deltas into one row with a streaming flag", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1", status: "running" });
    const apply = useSessionStore.getState().applyStreamEvent;
    apply("a1", { type: "assistant_message", rowId: "m1", seq: 1, delta: "Hel" } as never);
    apply("a1", { type: "assistant_message", rowId: "m1", seq: 1, delta: "lo" } as never);
    const rows = useSessionStore.getState().agents["a1"]!.timeline.rows;
    const row = rows.find((r) => r.rowId === "m1")!;
    expect((row.payload as { text: string }).text).toBe("Hello");
    expect((row.payload as { streaming: boolean }).streaming).toBe(true);
  });

  it("clears the streaming flag on a completion event", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1", status: "running" });
    const apply = useSessionStore.getState().applyStreamEvent;
    apply("a1", { type: "assistant_message", rowId: "m1", seq: 1, delta: "done" } as never);
    apply("a1", { type: "assistant_message", rowId: "m1", seq: 1, done: true, text: "done" } as never);
    const row = useSessionStore.getState().agents["a1"]!.timeline.rows.find((r) => r.rowId === "m1")!;
    expect((row.payload as { text: string }).text).toBe("done");
    expect((row.payload as { streaming: boolean }).streaming).toBe(false);
  });
});

describe("SessionStore — timeline truncation (rewind)", () => {
  beforeEach(resetStore);

  function seedRows(agentId: string) {
    useSessionStore.getState().upsertAgent({ agentId, status: "running" });
    const apply = useSessionStore.getState().applyStreamEvent;
    apply(agentId, { type: "user_message", rowId: "u1", seq: 1, text: "hi" } as never);
    apply(agentId, { type: "assistant_message", rowId: "a1", seq: 2, text: "yo", done: true } as never);
    apply(agentId, { type: "user_message", rowId: "u2", seq: 3, text: "more" } as never);
    apply(agentId, { type: "assistant_message", rowId: "a2", seq: 4, text: "ok", done: true } as never);
  }

  it("drops rows at and after the target messageId", () => {
    seedRows("a1");
    useSessionStore.getState().truncateTimelineAfter("a1", "u2");
    const ids = useSessionStore.getState().agents["a1"]!.timeline.rows.map((r) => r.rowId);
    expect(ids).toEqual(["u1", "a1"]);
  });

  it("is a no-op when the messageId is not found", () => {
    seedRows("a1");
    useSessionStore.getState().truncateTimelineAfter("a1", "missing");
    expect(useSessionStore.getState().agents["a1"]!.timeline.rows).toHaveLength(4);
  });
});

describe("SessionStore — agent usage", () => {
  beforeEach(resetStore);

  it("setAgentUsage stores and merges usage", () => {
    useSessionStore.getState().upsertAgent({ agentId: "a1", status: "running" });
    useSessionStore.getState().setAgentUsage("a1", { inputTokens: 800, provider: "anthropic" });
    useSessionStore.getState().setAgentUsage("a1", { outputTokens: 400, costUsd: 0.03 });
    const usage = useSessionStore.getState().agents["a1"]?.usage;
    expect(usage).toEqual({ inputTokens: 800, outputTokens: 400, costUsd: 0.03, provider: "anthropic" });
  });

  it("setAgentUsage creates the agent if missing", () => {
    useSessionStore.getState().setAgentUsage("ghost", { costUsd: 1 });
    expect(useSessionStore.getState().agents["ghost"]?.usage?.costUsd).toBe(1);
  });
});

describe("SessionStore — server info", () => {
  beforeEach(resetStore);

  it("sets server info", () => {
    useSessionStore.getState().setServerInfo({ serverId: "srv1", version: "1.0.0" });
    expect(useSessionStore.getState().servers["srv1"]?.version).toBe("1.0.0");
  });

  it("sets active server", () => {
    useSessionStore.getState().setActiveServer("srv1");
    expect(useSessionStore.getState().activeServerId).toBe("srv1");
  });

  it("clears active server", () => {
    useSessionStore.getState().setActiveServer("srv1");
    useSessionStore.getState().setActiveServer(null);
    expect(useSessionStore.getState().activeServerId).toBeNull();
  });
});

describe("SessionStore — subscribeSessionStore integration", () => {
  beforeEach(resetStore);

  it("populates store from agent_update events", async () => {
    const { subscribeSessionStore } = await import("../hooks/use-session-hooks.js");

    let agentUpdateHandler: ((msg: Record<string, unknown>) => void) | undefined;
    let sessionMessageHandler: ((msg: unknown) => void) | undefined;

    const mockClient = {
      onAgentUpdate: (handler: (msg: Record<string, unknown>) => void) => {
        agentUpdateHandler = handler;
        return () => {};
      },
      connection: {
        onSessionMessage: (handler: (msg: unknown) => void) => {
          sessionMessageHandler = handler;
          return () => {};
        },
      },
    };

    const unsub = subscribeSessionStore(mockClient as never);

    // Simulate agent_update event
    agentUpdateHandler?.({
      type: "agent_update",
      agentId: "a1",
      status: "running",
      title: "My Agent",
      labels: { key: "val" },
    });

    const a = useSessionStore.getState().agents["a1"]!;
    expect(a.status).toBe("running");
    expect(a.title).toBe("My Agent");

    // Simulate permission request
    sessionMessageHandler?.({
      type: "agent_permission_request",
      agentId: "a1",
      requestId: "req1",
      toolName: "shell",
      responses: ["allow", "deny"],
    });

    expect(useSessionStore.getState().agents["a1"]?.permissions["req1"]?.state).toBe("pending");

    // Simulate workspace update
    sessionMessageHandler?.({
      type: "workspace_update",
      workspaceId: "ws1",
      name: "My Workspace",
      agentIds: ["a1"],
    });

    expect(useSessionStore.getState().workspaces["ws1"]?.name).toBe("My Workspace");

    // Simulate agent_usage event
    sessionMessageHandler?.({
      type: "agent_usage",
      agentId: "a1",
      usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.01, provider: "anthropic" },
    });

    expect(useSessionStore.getState().agents["a1"]?.usage?.costUsd).toBe(0.01);
    expect(useSessionStore.getState().agents["a1"]?.usage?.inputTokens).toBe(100);

    unsub();
  });
});
