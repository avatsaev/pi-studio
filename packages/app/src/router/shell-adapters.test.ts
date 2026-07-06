import { describe, it, expect } from "vitest";
import {
  toHostConnectionStatus,
  connectionToHostSnapshots,
  activeHostSnapshot,
  toCommandCenterStatus,
  pendingPermissionCount,
  toCommandCenterAgents,
} from "./shell-adapters.js";
import type { AgentEntry } from "../store/session-store.js";

function makeAgent(overrides: Partial<AgentEntry> = {}): AgentEntry {
  return {
    agentId: "a1",
    status: "idle",
    labels: {},
    capabilities: {} as AgentEntry["capabilities"],
    permissions: {},
    timeline: { rows: [], cursor: undefined } as unknown as AgentEntry["timeline"],
    lastActivity: 1000,
    optimisticMessages: {},
    ...overrides,
  };
}

describe("toHostConnectionStatus", () => {
  it("maps every AppConnectionStatus to a ConnectionStatus", () => {
    expect(toHostConnectionStatus("no-hosts")).toBe("idle");
    expect(toHostConnectionStatus("connecting")).toBe("connecting");
    expect(toHostConnectionStatus("connected")).toBe("online");
    expect(toHostConnectionStatus("reconnecting")).toBe("connecting");
    expect(toHostConnectionStatus("error")).toBe("error");
  });
});

describe("connectionToHostSnapshots", () => {
  it("returns an empty array when no daemon address is configured", () => {
    expect(connectionToHostSnapshots({ status: "no-hosts", serverId: null, address: null })).toEqual([]);
  });

  it("builds a single online snapshot when connected", () => {
    const snapshots = connectionToHostSnapshots({
      status: "connected",
      serverId: "srv-1",
      address: "ws://127.0.0.1:6767",
    });
    expect(snapshots).toHaveLength(1);
    const snap = snapshots[0]!;
    expect(snap.status).toBe("online");
    expect(snap.serverId).toBe("srv-1");
    expect(snap.profile.kind).toBe("direct");
    expect(snap.client?.serverInfo.serverId).toBe("srv-1");
  });

  it("builds a connecting snapshot with no client when not yet online", () => {
    const snap = connectionToHostSnapshots({
      status: "connecting",
      serverId: null,
      address: "ws://127.0.0.1:6767",
    })[0]!;
    expect(snap.status).toBe("connecting");
    expect(snap.client).toBeUndefined();
  });

  it("maps reconnecting/error statuses", () => {
    expect(
      connectionToHostSnapshots({ status: "reconnecting", serverId: "s", address: "ws://x" })[0]!.status,
    ).toBe("connecting");
    expect(
      connectionToHostSnapshots({ status: "error", serverId: null, address: "ws://x" })[0]!.status,
    ).toBe("error");
  });
});

describe("activeHostSnapshot", () => {
  it("returns undefined when disconnected", () => {
    expect(activeHostSnapshot({ status: "no-hosts", serverId: null, address: null })).toBeUndefined();
  });

  it("returns the single host when connected", () => {
    const host = activeHostSnapshot({ status: "connected", serverId: "s1", address: "ws://x" });
    expect(host?.serverId).toBe("s1");
  });
});

describe("toCommandCenterStatus", () => {
  it("maps daemon AgentStatus to CommandCenterAgent status", () => {
    expect(toCommandCenterStatus("initializing")).toBe("queued");
    expect(toCommandCenterStatus("idle")).toBe("idle");
    expect(toCommandCenterStatus("running")).toBe("running");
    expect(toCommandCenterStatus("error")).toBe("error");
    expect(toCommandCenterStatus("closed")).toBe("finished");
  });
});

describe("pendingPermissionCount", () => {
  it("counts only pending permissions", () => {
    const agent = makeAgent({
      permissions: {
        r1: { requestId: "r1", agentId: "a1", state: "pending" },
        r2: { requestId: "r2", agentId: "a1", state: "resolved" },
        r3: { requestId: "r3", agentId: "a1", state: "pending" },
      },
    });
    expect(pendingPermissionCount(agent)).toBe(2);
  });

  it("returns 0 with no permissions", () => {
    expect(pendingPermissionCount(makeAgent())).toBe(0);
  });
});

describe("toCommandCenterAgents", () => {
  it("maps AgentEntry[] to CommandCenterAgent[] with derived attention flags", () => {
    const agents = [
      makeAgent({ agentId: "a1", status: "running", title: "Fix bug", cwd: "/tmp/x" }),
      makeAgent({
        agentId: "a2",
        status: "idle",
        permissions: { r1: { requestId: "r1", agentId: "a2", state: "pending" } },
      }),
    ];
    const rows = toCommandCenterAgents(agents, "srv-1");
    expect(rows).toEqual([
      {
        serverId: "srv-1",
        agentId: "a1",
        title: "Fix bug",
        cwd: "/tmp/x",
        status: "running",
        requiresAttention: false,
        pendingPermissionCount: 0,
        lastActivityMs: 1000,
      },
      {
        serverId: "srv-1",
        agentId: "a2",
        title: undefined,
        cwd: undefined,
        status: "idle",
        requiresAttention: true,
        pendingPermissionCount: 1,
        lastActivityMs: 1000,
      },
    ]);
  });

  it("falls back to a local host id when serverId is null", () => {
    const row = toCommandCenterAgents([makeAgent()], null)[0]!;
    expect(row.serverId).toBe("local-daemon");
  });
});
