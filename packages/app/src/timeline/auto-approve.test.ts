import { describe, it, expect } from "vitest";
import {
  evaluateAutoApprove,
  buildRespondPayload,
  PERMISSION_RESPOND_RPC,
  type AutoApproveRule,
} from "./auto-approve.js";

describe("evaluateAutoApprove", () => {
  const rules: AutoApproveRule[] = [
    { tool: "read", respondWith: "allow_once" },
    { tool: "shell_*", respondWith: "allow_always" },
    { tool: "*", respondWith: "deny" }, // catch-all last
  ];

  it("matches an exact tool name", () => {
    expect(evaluateAutoApprove({ requestId: "r", toolName: "read" }, rules)).toBe("allow_once");
  });

  it("matches a prefix wildcard", () => {
    expect(evaluateAutoApprove({ requestId: "r", toolName: "shell_run" }, rules)).toBe("allow_always");
  });

  it("falls through to a catch-all", () => {
    expect(evaluateAutoApprove({ requestId: "r", toolName: "unknown_tool" }, rules)).toBe("deny");
  });

  it("returns undefined when no rule matches (prompt must show)", () => {
    expect(evaluateAutoApprove({ requestId: "r", toolName: "write" }, [{ tool: "read", respondWith: "allow_once" }])).toBeUndefined();
  });

  it("only auto-responds with an offered option", () => {
    const r = evaluateAutoApprove(
      { requestId: "r", toolName: "read", responses: ["allow", "deny"] },
      [{ tool: "read", respondWith: "allow_once" }],
    );
    expect(r).toBeUndefined(); // allow_once not offered
  });

  it("returns undefined without a tool name", () => {
    expect(evaluateAutoApprove({ requestId: "r" }, rules)).toBeUndefined();
  });
});

describe("buildRespondPayload", () => {
  it("shapes the respond RPC payload with server keys", () => {
    expect(buildRespondPayload("a1", "perm-1", "allow_once")).toEqual({
      agentId: "a1",
      permissionRequestId: "perm-1",
      response: "allow_once",
    });
    expect(PERMISSION_RESPOND_RPC).toBe("agent.permission.respond.request");
  });
});
