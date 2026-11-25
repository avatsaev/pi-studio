import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcError, type PiStudioClient } from "@av-pi-studio/client";
import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { resetToastStoreForTests, useToastStore } from "@av-pi-studio/ui-library";
import type { QueryClient } from "@tanstack/react-query";
import { applyAgentStreamEvent } from "../../hooks/agent-stream-events.js";
import { useSessionStore, type SessionEntry } from "../../stores/session-store.js";
import { EMPTY_TIMELINE } from "../../timeline/reducer.js";
import { SEND_FAILED_TOAST, sendFailureToast, sendPrompt } from "./composer-send.js";

interface SentPrompt {
  agentId: string;
  prompt: string;
  opts: { clientMessageId?: string; images?: unknown[] } | undefined;
}

/**
 * A daemon that answers `send` with `answer`, and `createAgent` with `created` (a draft's
 * materialize). The rest of the client is never reached by this flow.
 */
function fakeClient(
  answer: () => Promise<{ agentId: string }>,
  created: () => Promise<{ agentId: string }> = () => Promise.resolve({ agentId: "a-new" }),
): { client: PiStudioClient; sent: SentPrompt[]; createCalls: unknown[] } {
  const sent: SentPrompt[] = [];
  const createCalls: unknown[] = [];
  const client = {
    createAgent: (request: unknown) => {
      createCalls.push(request);
      return created();
    },
    agent: (agentId: string) => ({
      send: (prompt: string, opts?: SentPrompt["opts"]) => {
        sent.push({ agentId, prompt, opts });
        return answer();
      },
    }),
  } as unknown as PiStudioClient;
  return { client, sent, createCalls };
}

const accepted = (): Promise<{ agentId: string }> => Promise.resolve({ agentId: "a1" });
const refused = (message: string): (() => Promise<{ agentId: string }>) => {
  return () => Promise.reject(new RpcError(message, "r1", "handler_error"));
};

function entry(overrides: Partial<SessionEntry> = {}): SessionEntry {
  return {
    id: "s1",
    agentId: "a1",
    title: "Chat",
    status: "idle",
    cwd: "/work",
    model: "claude-sonnet-5",
    timeline: EMPTY_TIMELINE,
    userMessageCount: 0,
    ...overrides,
  };
}

const store = () => useSessionStore.getState();
const session = (): SessionEntry => {
  const found = store().sessions["s1"];
  if (!found) throw new Error("no session s1");
  return found;
};
const toasts = (): string[] => useToastStore.getState().toasts.map((t) => t.content);

/** An event of the agent's stream as the live subscription applies it. */
function streamEvent(event: AgentStreamEvent): void {
  applyAgentStreamEvent({
    sessionId: "s1",
    event,
    client: {} as PiStudioClient,
    queryClient: {} as QueryClient,
  });
}

/** An `agent_update` as the connection's listener applies it. */
function agentUpdate(status: string): void {
  store().applyStatusSignalByAgentId("a1", { source: "update", status });
}

/** What `Composer.submit` does before the request: the optimistic row, then the send. */
async function send(client: PiStudioClient, prompt = "hello"): Promise<void> {
  store().addOptimisticUserMessage("s1", "m1", prompt);
  await sendPrompt(client, { sessionId: "s1", prompt, clientMessageId: "m1" });
}

function userRow() {
  const row = session().timeline.rows.find((r) => r.kind === "user");
  if (row?.kind !== "user") throw new Error("no user row");
  return row;
}

beforeEach(() => {
  vi.useFakeTimers();
  useSessionStore.setState({ sessions: {}, order: [], activeSessionId: null });
  resetToastStoreForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sendPrompt — accepted", () => {
  it("sends the prompt with its clientMessageId and images to the session's agent", async () => {
    store().hydrate(entry());
    const { client, sent } = fakeClient(accepted);
    store().addOptimisticUserMessage("s1", "m1", "look");
    const images = [{ mimeType: "image/png", data: "AAAA" }];
    await sendPrompt(client, { sessionId: "s1", prompt: "look", clientMessageId: "m1", images });
    expect(sent).toEqual([
      { agentId: "a1", prompt: "look", opts: { clientMessageId: "m1", images } },
    ]);
  });

  it("is running from the answer, before any event of the turn arrives", async () => {
    store().hydrate(entry());
    await send(fakeClient(accepted).client);
    // Running means the composer offers Steer, so a second Enter cannot start a second send.
    expect(session().status).toBe("running");
    expect(userRow()).toMatchObject({ pending: true });
    expect(toasts()).toEqual([]);
  });

  it("stays running through the turn's last row, then idle on the agent_update", async () => {
    store().hydrate(entry());
    await send(fakeClient(accepted).client);
    agentUpdate("running");
    streamEvent({ kind: "user_message", text: "hello", messageId: "m1" });
    streamEvent({ kind: "turn_started" });
    streamEvent({ kind: "assistant_message", text: "hi" });
    expect(session().status).toBe("running");
    streamEvent({ kind: "turn_completed" });
    // Still running: the composer offers Steer, never a Send the daemon would refuse as busy.
    expect(session().status).toBe("running");
    agentUpdate("idle");
    expect(session().status).toBe("idle");
    expect(userRow()).toMatchObject({ pending: false });
  });

  it("an inline-handled slash command ends on its agent_update alone", async () => {
    store().hydrate(entry());
    await send(fakeClient(accepted).client, "/ext-command");
    agentUpdate("running");
    streamEvent({ kind: "user_message", text: "/ext-command", messageId: "m1" });
    expect(session().status).toBe("running");
    agentUpdate("idle");
    expect(session().status).toBe("idle");
  });

  it("a turn that fails after acceptance ends error, not as a refused send", async () => {
    store().hydrate(entry());
    await send(fakeClient(accepted).client);
    agentUpdate("running");
    streamEvent({ kind: "user_message", text: "hello", messageId: "m1" });
    streamEvent({ kind: "turn_failed", error: "401 no credential" });
    expect(session().status).toBe("running");
    agentUpdate("error");
    expect(session().status).toBe("error");
    expect(userRow()).toMatchObject({ pending: false });
    expect(userRow().failed).toBeUndefined();
    expect(session().timeline.rows.at(-1)).toMatchObject({
      kind: "error",
      text: "401 no credential",
    });
    expect(toasts()).toEqual([]);
  });

  it("materializes a draft first, then sends to the agent it created", async () => {
    store().hydrate(entry({ agentId: null, cwd: "" }));
    const { client, sent, createCalls } = fakeClient(accepted, () =>
      Promise.resolve({ agentId: "a-new" }),
    );
    await send(client);
    expect(createCalls).toHaveLength(1);
    expect(sent.map((s) => s.agentId)).toEqual(["a-new"]);
    expect(session()).toMatchObject({ agentId: "a-new", cwd: "~", status: "running" });
  });
});

describe("sendPrompt — refused", () => {
  it("a busy refusal leaves the session idle, fails the row, and toasts the reason", async () => {
    store().hydrate(entry());
    await send(fakeClient(refused("busy: agent a1 is running")).client);
    expect(session().status).toBe("idle");
    expect(userRow()).toMatchObject({ failed: true, pending: false });
    expect(toasts()).toEqual(["Couldn't send: the agent is running."]);
  });

  it("an unknown agent is toasted with the daemon's message", async () => {
    store().hydrate(entry());
    await send(fakeClient(refused("unknown agent: a1")).client);
    expect(session().status).toBe("idle");
    expect(userRow()).toMatchObject({ failed: true });
    expect(toasts()).toEqual(["Couldn't send: unknown agent: a1"]);
  });

  it("a connection lost before the answer fails the row and says so", async () => {
    store().hydrate(entry());
    await send(
      fakeClient(() => Promise.reject(new Error("socket closed: connection lost"))).client,
    );
    expect(session().status).toBe("idle");
    expect(userRow()).toMatchObject({ failed: true });
    expect(toasts()).toEqual(["Couldn't send: socket closed: connection lost"]);
  });

  it("a draft that cannot be materialized fails the row without sending", async () => {
    store().hydrate(entry({ agentId: null }));
    const { client, sent } = fakeClient(accepted, () =>
      Promise.reject(new Error("socket closed: connection lost")),
    );
    await send(client);
    expect(sent).toEqual([]);
    expect(session().status).toBe("idle");
    expect(userRow()).toMatchObject({ failed: true });
    expect(toasts()).toEqual(["Couldn't send: socket closed: connection lost"]);
  });

  it("a refusal never turns an already-confirmed row into a failure", async () => {
    store().hydrate(entry());
    store().addOptimisticUserMessage("s1", "m1", "hello");
    store().applyStreamEvent("s1", { kind: "user_message", text: "hello", messageId: "m1" });
    await sendPrompt(fakeClient(refused("busy: agent a1 is running")).client, {
      sessionId: "s1",
      prompt: "hello",
      clientMessageId: "m1",
    });
    expect(userRow().failed).toBeUndefined();
    expect(toasts()).toEqual(["Couldn't send: the agent is running."]);
  });

  it("does nothing for a session that is gone", async () => {
    const { client, sent } = fakeClient(accepted);
    await sendPrompt(client, { sessionId: "gone", prompt: "x", clientMessageId: "m1" });
    expect(sent).toEqual([]);
    expect(toasts()).toEqual([]);
  });
});

describe("sendFailureToast", () => {
  it("names what the agent is busy with, without its id", () => {
    expect(
      sendFailureToast(new RpcError("busy: agent a1 is compacting", "r", "handler_error")),
    ).toBe("Couldn't send: the agent is compacting.");
    expect(sendFailureToast(new Error("busy: agent 3f9c-77 is changing its session"))).toBe(
      "Couldn't send: the agent is changing its session.",
    );
  });

  it("shows any other message as it came", () => {
    expect(sendFailureToast(new Error("unknown agent: a9"))).toBe(
      "Couldn't send: unknown agent: a9",
    );
  });

  it("falls back when there is no readable message", () => {
    expect(sendFailureToast(new Error(""))).toBe(SEND_FAILED_TOAST);
    expect(sendFailureToast("boom")).toBe(SEND_FAILED_TOAST);
    expect(sendFailureToast(undefined)).toBe(SEND_FAILED_TOAST);
  });
});
