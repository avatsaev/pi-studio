import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";

import { Session } from "../ws/session.js";
import { broadcast } from "./bootstrap.js";

function sessionOn(id: string, send: (data: string | Uint8Array) => void): Session {
  return new Session({
    id,
    clientId: `client-${id}`,
    clientType: "cli",
    capabilities: {},
    socket: { send } as unknown as WebSocket,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("broadcast", () => {
  it("serialises the envelope once and gives every session the same text", () => {
    const received: string[][] = [[], [], []];
    const sessions = received.map((into, i) =>
      sessionOn(String(i), (data) => void into.push(data as string)),
    );
    const stringify = vi.spyOn(JSON, "stringify");

    broadcast(sessions, { type: "agent_update", id: "a1" });

    expect(stringify).toHaveBeenCalledTimes(1);
    const wire = '{"type":"session","message":{"type":"agent_update","id":"a1"}}';
    expect(received).toEqual([[wire], [wire], [wire]]);
  });

  it("does not wrap a message that is already a session envelope", () => {
    const received: string[] = [];
    broadcast([sessionOn("0", (data) => void received.push(data as string))], {
      type: "session",
      message: { type: "x" },
    });
    expect(received).toEqual(['{"type":"session","message":{"type":"x"}}']);
  });

  it("skips a session whose socket throws and still reaches the others", () => {
    const received: string[] = [];
    const dead = sessionOn("dead", () => {
      throw new Error("not open");
    });
    const live = sessionOn("live", (data) => void received.push(data as string));

    broadcast([dead, live], { type: "t" });

    expect(received).toHaveLength(1);
  });
});
