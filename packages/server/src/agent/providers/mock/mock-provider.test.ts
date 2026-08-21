import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { describe, expect, it } from "vitest";

import type { AgentClient } from "../../provider-contract.js";
import { MOCK_CAPABILITIES, MockAgentClient, MockAgentSession } from "./mock-provider.js";

function collect(session: { subscribe: (cb: (e: AgentStreamEvent) => void) => void }): {
  events: AgentStreamEvent[];
} {
  const events: AgentStreamEvent[] = [];
  session.subscribe((e) => events.push(e));
  return { events };
}

/** Resolves once `predicate` matches an emitted event — deterministic in place of a wall-clock
 *  sleep after triggering an async response (sprint-068/task-001's scripted-turn tests). */
function waitForEvent(
  session: { subscribe: (cb: (e: AgentStreamEvent) => void) => () => void },
  predicate: (e: AgentStreamEvent) => boolean,
): Promise<AgentStreamEvent> {
  const { promise, resolve } = Promise.withResolvers<AgentStreamEvent>();
  const unsub = session.subscribe((e) => {
    if (predicate(e)) {
      unsub();
      resolve(e);
    }
  });
  return promise;
}

async function makeMockSession(): Promise<MockAgentSession> {
  const client = new MockAgentClient();
  return (await client.createSession({ provider: "mock", cwd: "/tmp" })) as MockAgentSession;
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

  it("implements slash-command operations (sprint-037) deterministically", async () => {
    const client = new MockAgentClient();
    const session = await client.createSession({ provider: "mock", cwd: "/tmp" });

    expect(await session.getSessionStats?.()).toEqual({
      sessionId: session.id,
      totalMessages: 0,
      tokens: { total: 0 },
    });
    expect(await session.compact?.()).toEqual({
      summary: "mock compaction summary",
      firstKeptEntryId: "mock-entry-0",
      tokensBefore: 0,
    });
    expect(await session.newSession?.()).toEqual({ cancelled: false });
    expect(await session.switchSession?.("/tmp/other.jsonl")).toEqual({ cancelled: false });
    expect(await session.fork?.("e1")).toEqual({
      text: "mock forked text for e1",
      cancelled: false,
    });
    expect(await session.getForkMessages?.()).toEqual([
      { entryId: "mock-entry-0", text: "mock first prompt" },
    ]);
    expect(await session.clone?.()).toEqual({ cancelled: false });
    await session.setSessionName?.("my-feature-work");
    expect(await session.cycleModel?.()).toEqual({
      model: { id: "mock-model" },
      thinkingLevel: "medium",
    });
    expect(await session.getLastAssistantText?.()).toBeNull();

    // Deliberately omitted so callers can exercise the unsupported-provider-method path.
    expect(session.exportHtml).toBeUndefined();
  });

  it("getLastAssistantText returns the most recent assistant message after a turn", async () => {
    const client = new MockAgentClient();
    const session = await client.createSession({ provider: "mock", cwd: "/tmp" });
    await session.run("hello");
    expect(await session.getLastAssistantText?.()).toContain("hello");
  });

  it("listCommands returns a deterministic multi-source list (sprint-040)", async () => {
    const client = new MockAgentClient();
    const session = await client.createSession({ provider: "mock", cwd: "/tmp" });
    expect(await session.listCommands?.()).toEqual([
      {
        id: "session-name",
        name: "session-name",
        description: "Set or clear session name",
        source: "extension",
        scope: "project",
        path: ".pi/agent/extensions/session.ts",
      },
      {
        id: "fix-tests",
        name: "fix-tests",
        description: "Fix failing tests",
        source: "prompt",
        scope: "project",
        path: ".pi/agent/prompts/fix-tests.md",
      },
      {
        id: "skill:brave-search",
        name: "skill:brave-search",
        description: "Web search via Brave API",
        source: "skill",
        scope: "user",
        path: "~/.pi/agent/skills/brave-search/SKILL.md",
      },
    ]);
    // exportHtml stays deliberately omitted (see the sprint-037 test above) so the
    // unsupported-provider-method → rpc_error path remains covered now that listCommands exists.
    expect(session.exportHtml).toBeUndefined();
  });
});

describe("extension UI (sprint-066, task-002)", () => {
  it("advertises supportsExtensionUi: true", async () => {
    const client = new MockAgentClient();
    expect(client.capabilities.supportsExtensionUi).toBe(true);
    const session = await client.createSession({ provider: "mock", cwd: "/tmp" });
    expect(session.capabilities.supportsExtensionUi).toBe(true);
  });

  it("emitUiRequest pushes a scripted request to every subscriber, filling sensible defaults", async () => {
    const client = new MockAgentClient();
    const session = (await client.createSession({
      provider: "mock",
      cwd: "/tmp",
    })) as MockAgentSession;
    const received: unknown[] = [];
    session.onUiRequest((req) => received.push(req));

    const emitted = session.emitUiRequest({ method: "confirm", payload: { message: "Proceed?" } });

    expect(received).toEqual([emitted]);
    expect(emitted.method).toBe("confirm");
    expect(emitted.expectsResponse).toBe(true);
    expect(emitted.payload).toEqual({ message: "Proceed?" });
    expect(typeof emitted.requestId).toBe("string");
  });

  it("respondToUi records the answer so a test can assert what the provider received", async () => {
    const client = new MockAgentClient();
    const session = (await client.createSession({
      provider: "mock",
      cwd: "/tmp",
    })) as MockAgentSession;

    const req = session.emitUiRequest({ method: "select" });
    session.respondToUi(req.requestId, { value: "Allow" });

    expect(session.uiResponses).toEqual([
      { providerRequestId: req.requestId, response: { value: "Allow" } },
    ]);
  });

  it("onUiRequest's Unsubscribe detaches the callback", async () => {
    const client = new MockAgentClient();
    const session = (await client.createSession({
      provider: "mock",
      cwd: "/tmp",
    })) as MockAgentSession;
    const received: unknown[] = [];
    const unsub = session.onUiRequest((req) => received.push(req));

    session.emitUiRequest({ method: "notify" });
    unsub();
    session.emitUiRequest({ method: "notify" });

    expect(received.length).toBe(1);
  });
});

describe("#ui script trigger (sprint-068, task-001)", () => {
  it("a scripted prompt raises the dialog instead of the normal echoed turn", async () => {
    const session = await makeMockSession();
    const { events } = collect(session);
    const uiRequests: unknown[] = [];
    session.onUiRequest((req) => uiRequests.push(req));

    await session.startTurn("#ui select");

    expect(uiRequests).toHaveLength(1);
    expect(events.some((e) => e.kind === "assistant_message")).toBe(false);
    expect(events.some((e) => e.kind === "turn_completed")).toBe(false);
  });

  it("answering the scripted dialog completes the turn and echoes the answer received", async () => {
    const session = await makeMockSession();
    const { events } = collect(session);
    let raised: { requestId: string } | undefined;
    session.onUiRequest((req) => (raised = req));

    await session.startTurn("#ui select");
    expect(raised).toBeDefined();
    const completed = waitForEvent(session, (e) => e.kind === "turn_completed");
    session.respondToUi(raised!.requestId, { value: "Allow" });
    await completed;

    const message = events.find((e) => e.kind === "assistant_message");
    expect(message && "text" in message ? message.text : undefined).toContain('value: "Allow"');
    expect(events.some((e) => e.kind === "turn_completed")).toBe(true);
  });

  it("cancelling a scripted dialog produces text showing the cancellation", async () => {
    const session = await makeMockSession();
    const { events } = collect(session);
    let raised: { requestId: string } | undefined;
    session.onUiRequest((req) => (raised = req));

    await session.startTurn("#ui confirm");
    const completed = waitForEvent(session, (e) => e.kind === "turn_completed");
    session.respondToUi(raised!.requestId, { cancelled: true });
    await completed;

    const message = events.find((e) => e.kind === "assistant_message");
    expect(message && "text" in message ? message.text : undefined).toContain("cancelled: true");
  });

  it("#ui multi 3 raises three dialogs that are all pending simultaneously", async () => {
    const session = await makeMockSession();
    const raised: { requestId: string }[] = [];
    session.onUiRequest((req) => raised.push(req));

    await session.startTurn("#ui multi 3");

    expect(raised).toHaveLength(3);
    expect(new Set(raised.map((r) => r.requestId)).size).toBe(3);
  });

  it("#ui help lists every recipe as assistant text and raises no dialog", async () => {
    const session = await makeMockSession();
    const { events } = collect(session);
    const uiRequests: unknown[] = [];
    session.onUiRequest((req) => uiRequests.push(req));

    const completed = waitForEvent(session, (e) => e.kind === "turn_completed");
    await session.startTurn("#ui help");
    await completed;

    expect(uiRequests).toHaveLength(0);
    const message = events.find((e) => e.kind === "assistant_message");
    expect(message && "text" in message ? message.text : undefined).toContain("#ui select");
    expect(events.some((e) => e.kind === "turn_completed")).toBe(true);
  });

  it("an ordinary prompt is unaffected and still echoes normally", async () => {
    const session = await makeMockSession();
    const { events } = collect(session);
    await session.run("hello there");
    const message = events.find((e) => e.kind === "assistant_message");
    expect(message && "text" in message ? message.text : undefined).toBe("echo: hello there");
  });
});
