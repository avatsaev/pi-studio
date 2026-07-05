import { describe, expect, it } from "vitest";
import { AgentTimelineStore as TimelineStore } from "./timeline-store.js";
import type { AgentStreamEvent } from "@av-pi-studio/protocol";
import { vi } from "vitest";
import { HandlerRegistry, routeTextFrame } from "../ws/router.js";
import type { Session } from "../ws/session.js";
import { registerRewindHandler } from "./rewind-rpc.js";

function fakeSession() {
  const sent: unknown[] = [];
  return { sent, send: (m: unknown) => sent.push(m), close: vi.fn() } as unknown as Session & { sent: unknown[] };
}

async function dispatch(session: Session, req: unknown, registry: HandlerRegistry): Promise<unknown> {
  await routeTextFrame(session, JSON.stringify({ type: "session", message: req }), registry);
  const last = (session as unknown as { sent: unknown[] }).sent.at(-1) as { message?: unknown } | undefined;
  return last?.message;
}

function makeStore(messageIds: string[]): TimelineStore {
  const events: AgentStreamEvent[] = messageIds.map((id) => ({
    kind: "user_message" as const,
    messageId: id,
    text: `Message ${id}`,
  } as unknown as AgentStreamEvent));
  return new TimelineStore({ initialRows: events.map((event, i) => ({ epoch: 1, seq: i + 1, timestamp: new Date(i * 1000).toISOString(), event })) });
}

describe("TimelineStore.truncateBeforeMessage", () => {
  it("truncates rows before the target messageId", () => {
    const store = makeStore(["m1", "m2", "m3", "m4"]);
    expect(store.rowCount()).toBe(4);
    store.truncateBeforeMessage("m3");
    // Rows before m3 (index 2) are retained: m1, m2
    expect(store.rowCount()).toBe(2);
  });

  it("truncates all rows when first message is targeted", () => {
    const store = makeStore(["m1", "m2"]);
    store.truncateBeforeMessage("m1");
    expect(store.rowCount()).toBe(0);
  });

  it("returns the timestamp of the last retained row", () => {
    const store = makeStore(["m1", "m2", "m3"]);
    const ts = store.truncateBeforeMessage("m3");
    expect(ts).toBeTruthy();
  });
});

describe("registerRewindHandler", () => {
  it("handles agent.rewind.request with mode=conversation", async () => {
    const store = makeStore(["m1", "m2", "m3"]);
    const registry = new HandlerRegistry();
    registerRewindHandler(registry, { getTimelineStore: () => store, revertFilesSince: async () => {} });
    const session = fakeSession();
    const response = await dispatch(session, { type: "agent.rewind.request", requestId: "r1", agentId: "a1", messageId: "m3", mode: "conversation" }, registry);
    expect(response, JSON.stringify(response)).toMatchObject({ type: "agent.rewind.response", requestId: "r1", payload: { mode: "conversation" } });
    expect(store.rowCount()).toBe(2);
  });

  it("handles mode=files without touching conversation", async () => {
    const store = makeStore(["m1", "m2", "m3"]);
    let reverted = false;
    const registry = new HandlerRegistry();
    registerRewindHandler(registry, { getTimelineStore: () => store, revertFilesSince: async () => { reverted = true; } });
    await dispatch(fakeSession(), { type: "agent.rewind.request", requestId: "r2", agentId: "a1", messageId: "m2", mode: "files" }, registry);
    expect(store.rowCount()).toBe(3);
    expect(reverted).toBe(true);
  });

  it("handles mode=both truncates and reverts", async () => {
    const store = makeStore(["m1", "m2", "m3", "m4"]);
    let reverted = false;
    const registry = new HandlerRegistry();
    registerRewindHandler(registry, { getTimelineStore: () => store, revertFilesSince: async () => { reverted = true; } });
    await dispatch(fakeSession(), { type: "agent.rewind.request", requestId: "r3", agentId: "a1", messageId: "m3", mode: "both" }, registry);
    expect(store.rowCount()).toBe(2);
    expect(reverted).toBe(true);
  });
});
