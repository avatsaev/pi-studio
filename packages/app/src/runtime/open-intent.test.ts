import { describe, it, expect } from "vitest";
import { parseOpenIntent, buildOpenIntent, type WorkspaceOpenIntent } from "./route-grammar.js";
import { openIntentToTabTarget } from "../workspace/tabs.js";

describe("parseOpenIntent — ?open vocabulary", () => {
  it("parses agent:<id>", () => {
    expect(parseOpenIntent("agent:a1")).toEqual({ kind: "agent", id: "a1" });
  });
  it("parses terminal:<id>", () => {
    expect(parseOpenIntent("terminal:t1")).toEqual({ kind: "terminal", id: "t1" });
  });
  it("parses browser:<id>", () => {
    expect(parseOpenIntent("browser:b1")).toEqual({ kind: "browser", id: "b1" });
  });
  it("parses file:<base64path> and round-trips", () => {
    const intent: WorkspaceOpenIntent = { kind: "file", path: "/home/av/DEV/pi/package.json" };
    const encoded = buildOpenIntent(intent);
    expect(encoded.startsWith("file:")).toBe(true);
    expect(parseOpenIntent(encoded)).toEqual(intent);
  });
  it("round-trips agent/terminal/browser through build+parse", () => {
    for (const intent of [
      { kind: "agent", id: "a1" },
      { kind: "terminal", id: "t1" },
      { kind: "browser", id: "b1" },
      { kind: "draft", id: "d1" },
    ] as WorkspaceOpenIntent[]) {
      expect(parseOpenIntent(buildOpenIntent(intent))).toEqual(intent);
    }
  });
  it("returns null for empty/garbage", () => {
    expect(parseOpenIntent(undefined)).toBeNull();
    expect(parseOpenIntent("")).toBeNull();
    expect(parseOpenIntent("nocolon")).toBeNull();
    expect(parseOpenIntent("agent:")).toBeNull();
    expect(parseOpenIntent("bogus:x")).toBeNull();
  });
});

describe("openIntentToTabTarget", () => {
  it("maps each intent kind to the correct tab target", () => {
    expect(openIntentToTabTarget({ kind: "agent", id: "a1" })).toEqual({ kind: "agent", agentId: "a1" });
    expect(openIntentToTabTarget({ kind: "terminal", id: "t1" })).toEqual({ kind: "terminal", terminalId: "t1" });
    expect(openIntentToTabTarget({ kind: "browser", id: "b1" })).toEqual({ kind: "browser", browserId: "b1" });
    expect(openIntentToTabTarget({ kind: "file", path: "/a/b.ts" })).toEqual({ kind: "file", path: "/a/b.ts" });
    expect(openIntentToTabTarget({ kind: "draft", id: "d1" })).toEqual({ kind: "draft", draftId: "d1" });
    expect(openIntentToTabTarget({ kind: "setup", workspaceId: "w1" })).toEqual({ kind: "setup", workspaceId: "w1" });
  });
});
