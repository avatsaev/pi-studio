import { describe, expect, it, vi } from "vitest";

import { HandlerRegistry, routeTextFrame } from "./router.js";
import type { Session } from "./session.js";

interface FakeSession {
  sent: unknown[];
  close: ReturnType<typeof vi.fn>;
  send: (env: unknown) => void;
}

function fakeSession(): FakeSession & Session {
  const sent: unknown[] = [];
  const session = {
    sent,
    close: vi.fn(),
    send: (env: unknown) => sent.push(env),
  };
  return session as unknown as FakeSession & Session;
}

describe("ping/pong", () => {
  it("answers ping with a pong echoing requestId", async () => {
    const s = fakeSession();
    await routeTextFrame(
      s,
      JSON.stringify({ type: "ping", requestId: "p1", clientSentAt: 123 }),
      new HandlerRegistry(),
    );
    expect(s.sent).toHaveLength(1);
    const pong = s.sent[0] as Record<string, unknown>;
    expect(pong.type).toBe("pong");
    expect(pong.requestId).toBe("p1");
    expect(typeof pong.serverReceivedAt).toBe("number");
    expect(typeof pong.serverSentAt).toBe("number");
  });
});

describe("session dispatch", () => {
  it("routes to a registered handler and wraps + correlates the response", async () => {
    const registry = new HandlerRegistry().register("do.thing.request", () => ({
      type: "do.thing.response",
      payload: { ok: true },
    }));
    const s = fakeSession();
    await routeTextFrame(
      s,
      JSON.stringify({ type: "session", message: { type: "do.thing.request", requestId: "r1" } }),
      registry,
    );
    expect(s.sent[0]).toEqual({
      type: "session",
      message: { type: "do.thing.response", payload: { ok: true }, requestId: "r1" },
    });
  });

  it("resolves legacy flat names via an alias", async () => {
    const handler = vi.fn(() => undefined);
    const registry = new HandlerRegistry()
      .register("do.thing.request", handler)
      .registerAlias("do_thing", "do.thing.request");
    const s = fakeSession();
    await routeTextFrame(
      s,
      JSON.stringify({ type: "session", message: { type: "do_thing", requestId: "r2" } }),
      registry,
    );
    expect(handler).toHaveBeenCalledOnce();
  });

  it("emits rpc_error (correlated) when a handler throws, without closing the socket", async () => {
    const registry = new HandlerRegistry().register("boom.request", () => {
      throw new Error("kaboom");
    });
    const s = fakeSession();
    await routeTextFrame(
      s,
      JSON.stringify({ type: "session", message: { type: "boom.request", requestId: "r3" } }),
      registry,
    );
    expect(s.sent[0]).toEqual({
      type: "session",
      message: { type: "rpc_error", requestId: "r3", code: "handler_error", message: "kaboom" },
    });
    expect(s.close).not.toHaveBeenCalled();
  });

  it("does not close the socket when an RPC times out (rejects late)", async () => {
    const registry = new HandlerRegistry().register("slow.request", async () => {
      await new Promise((_resolve, reject) => setTimeout(() => reject(new Error("timeout")), 5));
    });
    const s = fakeSession();
    await routeTextFrame(
      s,
      JSON.stringify({ type: "session", message: { type: "slow.request", requestId: "r4" } }),
      registry,
    );
    expect((s.sent[0] as Record<string, unknown>).type).toBe("session");
    expect(s.close).not.toHaveBeenCalled();
  });

  it("rpc_errors an unknown type with a requestId, ignores one without", async () => {
    const s = fakeSession();
    const reg = new HandlerRegistry();
    await routeTextFrame(
      s,
      JSON.stringify({ type: "session", message: { type: "unknown.request", requestId: "r5" } }),
      reg,
    );
    await routeTextFrame(
      s,
      JSON.stringify({ type: "session", message: { type: "fire_and_forget" } }),
      reg,
    );
    expect(s.sent).toHaveLength(1);
    expect((s.sent[0] as { message: { code: string } }).message.code).toBe("unknown_message_type");
  });
});
