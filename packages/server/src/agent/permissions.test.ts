import { describe, expect, it } from "vitest";

import { AgentManager } from "./agent-manager.js";
import { PermissionService, PermissionStore } from "./permissions.js";

function makeService(): { service: PermissionService; broadcasts: unknown[] } {
  const broadcasts: unknown[] = [];
  const manager = new AgentManager({
    home: "/unused",
    saveAgent: () => Promise.resolve(),
    loadAllAgents: () => Promise.resolve([]),
  });
  const svc = new PermissionService({
    manager,
    broadcast: (_, m) => broadcasts.push(m),
    store: new PermissionStore(),
  });
  return { service: svc, broadcasts };
}

describe("permission flow", () => {
  it("emits agent_permission_request and pauses until resolved", async () => {
    const { service, broadcasts } = makeService();
    const { requestId, decision } = service.requestPermission(
      { agentId: "a1", toolName: "shell", action: { command: "rm -rf /" } },
      () => [],
    );

    const found = broadcasts.find(
      (b) =>
        (b as Record<string, unknown>).type === "session" &&
        ((b as Record<string, unknown>).message as Record<string, unknown>)?.type ===
          "agent_permission_request",
    ) as Record<string, unknown>;
    expect(found).toBeDefined();
    expect((found?.message as Record<string, unknown>)?.requestId).toBe(requestId);

    const result = service.handleRespond(
      { requestId: "rpc-1", permissionRequestId: requestId, response: "allow" },
      () => [],
    );
    expect((result.payload as Record<string, unknown>).resolved).toBe(true);
    expect(await decision).toBe("allow");
    expect(
      broadcasts.some(
        (b) =>
          (b as Record<string, unknown>).type === "session" &&
          ((b as Record<string, unknown>).message as Record<string, unknown>)?.type ===
            "agent_permission_resolved",
      ),
    ).toBe(true);
  });

  it("first resolution wins; second call returns resolved:false", () => {
    const { service } = makeService();
    const { requestId } = service.requestPermission({ agentId: "a2" }, () => []);
    const first = service.handleRespond(
      { requestId: "r1", permissionRequestId: requestId, response: "allow" },
      () => [],
    );
    const second = service.handleRespond(
      { requestId: "r2", permissionRequestId: requestId, response: "deny" },
      () => [],
    );
    expect((first.payload as Record<string, unknown>).resolved).toBe(true);
    expect((second.payload as Record<string, unknown>).resolved).toBe(false);
  });

  it("full-access mode: no permission request emitted (caller gate — never calls requestPermission)", () => {
    const { broadcasts } = makeService();
    expect(broadcasts).toHaveLength(0);
  });

  it("combined select+allowComment auto-resolves the follow-up input", () => {
    const { service, broadcasts } = makeService();
    const { requestId: selectId } = service.requestPermission(
      { agentId: "a3", questionKind: "select", allowComment: true },
      () => [],
    );
    service.requestPermission({ agentId: "a3", questionKind: "input" }, () => []);

    service.handleRespond(
      {
        requestId: "r1",
        permissionRequestId: selectId,
        response: { value: "option-A", comment: "see ticket #42" },
      },
      () => [],
    );

    const resolved = broadcasts.filter(
      (b) =>
        (b as Record<string, unknown>).type === "session" &&
        ((b as Record<string, unknown>).message as Record<string, unknown>)?.type ===
          "agent_permission_resolved",
    );
    expect(resolved).toHaveLength(2);
  });

  it("interrupt cancels pending permissions with decision:canceled", () => {
    const { service, broadcasts } = makeService();
    service.requestPermission({ agentId: "a4" }, () => []);
    service.requestPermission({ agentId: "a4" }, () => []);
    service.cancelPending("a4", () => []);
    const canceled = broadcasts.filter(
      (b) =>
        (b as Record<string, unknown>).type === "session" &&
        ((b as Record<string, unknown>).message as Record<string, unknown>)?.type ===
          "agent_permission_resolved" &&
        ((b as Record<string, unknown>).message as Record<string, unknown>)?.decision ===
          "canceled",
    );
    expect(canceled).toHaveLength(2);
  });
});
