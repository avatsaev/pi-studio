import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { describe, expect, it } from "vitest";

import type { AgentClient } from "../../provider-contract.js";
import { MOCK_CAPABILITIES, MockAgentClient } from "./mock-provider.js";

function collect(session: { subscribe: (cb: (e: AgentStreamEvent) => void) => void }): {
  events: AgentStreamEvent[];
} {
  const events: AgentStreamEvent[] = [];
  session.subscribe((e) => events.push(e));
  return { events };
}

describe("mock provider", () => {
  it("creates a session and streams a scripted turn", async () => {
    const client = new MockAgentClient();
    const session = await client.createSession({ provider: "mock", cwd: "/tmp" });
    const { events } = collect(session);
    await session.run("hello");
    expect(events.map((e) => e.kind)).toEqual([
      "turn_started",
      "assistant_message",
      "turn_completed",
    ]);
    const assistant = events.find((e) => e.kind === "assistant_message");
    expect(assistant && "text" in assistant ? assistant.text : "").toContain("hello");
  });

  it("exposes capability flags", async () => {
    const client = new MockAgentClient();
    expect(client.capabilities).toEqual(MOCK_CAPABILITIES);
    expect(client.capabilities.supportsStreaming).toBe(true);
    expect(client.capabilities.supportsMcpServers).toBe(false);
    const session = await client.createSession({ provider: "mock", cwd: "/tmp" });
    expect(session.capabilities).toEqual(MOCK_CAPABILITIES);
  });

  it("interrupt cancels the active turn (turn_canceled, no completion)", async () => {
    const client = new MockAgentClient();
    const session = await client.createSession({ provider: "mock", cwd: "/tmp" });
    const { events } = collect(session);
    await session.startTurn("long task");
    await session.interrupt();
    // Give any stray timer a chance to (incorrectly) fire.
    await new Promise((r) => setTimeout(r, 15));
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("turn_started");
    expect(kinds).toContain("turn_canceled");
    expect(kinds).not.toContain("turn_completed");
  });

  it("reports availability, models, modes, runtime info and a persistence handle", async () => {
    const client = new MockAgentClient();
    expect(client.isAvailable()).toBe(true);
    expect(await client.listModels()).toEqual([{ id: "mock-model", label: "Mock Model" }]);
    const session = await client.createSession({ provider: "mock", cwd: "/tmp", model: "m1" });
    expect(session.getRuntimeInfo().model).toBe("m1");
    expect(session.getAvailableModes().length).toBeGreaterThan(0);
    expect(session.describePersistence()?.provider).toBe("mock");
  });

  it("satisfies the provider-neutral AgentClient type", () => {
    const client: AgentClient = new MockAgentClient();
    expect(client.provider).toBe("mock");
  });
});
