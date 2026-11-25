import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";

import { silentLogger, type Logger } from "../logging/logger.js";
import { MAX_SEND_QUEUE_BYTES } from "./limits.js";
import { Session } from "./session.js";

/** A socket whose queue the test sets; records what it was asked to send, close and terminate. */
class FakeSocket {
  bufferedAmount: number | undefined = 0;
  readonly sent: Array<string | Uint8Array> = [];
  readonly close = vi.fn<(code?: number, reason?: string) => void>();
  readonly terminate = vi.fn<() => void>();

  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }
}

function setup(over: { transport?: "direct" | "relay" } = {}) {
  const socket = new FakeSocket();
  const warn = vi.fn();
  const logger: Logger = { ...silentLogger(), warn };
  const session = new Session({
    id: "s1",
    clientId: "client-slow",
    clientType: "browser",
    capabilities: {},
    socket: socket as unknown as WebSocket,
    logger,
    ...over,
  });
  return { socket, warn, session };
}

describe("Session send queue cap", () => {
  it("sends text, serialised envelopes and bytes while the queue is at or below the cap", () => {
    const { socket, session, warn } = setup();
    socket.bufferedAmount = MAX_SEND_QUEUE_BYTES;
    session.send({ type: "ping" });
    session.sendText('{"type":"pong"}');
    session.sendBinary(new Uint8Array([1, 2]));

    expect(socket.sent).toEqual(['{"type":"ping"}', '{"type":"pong"}', new Uint8Array([1, 2])]);
    expect(socket.close).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["an envelope", (s: Session) => s.send({ type: "session", message: {} })],
    ["serialised text", (s: Session) => s.sendText("{}")],
    ["bytes", (s: Session) => s.sendBinary(new Uint8Array([1]))],
  ])(
    "closes with 1013, terminates and logs the client instead of sending %s over the cap",
    (_name, push) => {
      const { socket, session, warn } = setup();
      socket.bufferedAmount = MAX_SEND_QUEUE_BYTES + 1;
      push(session);

      expect(socket.sent).toEqual([]);
      expect(socket.close).toHaveBeenCalledTimes(1);
      expect(socket.close).toHaveBeenCalledWith(1013, "send queue full");
      expect(socket.terminate).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toMatchObject({
        clientId: "client-slow",
        clientType: "browser",
        sessionId: "s1",
        via: "direct",
        queuedBytes: MAX_SEND_QUEUE_BYTES + 1,
      });
    },
  );

  it("cuts a session off once: later sends are dropped without a second close or log line", () => {
    const { socket, session, warn } = setup({ transport: "relay" });
    socket.bufferedAmount = MAX_SEND_QUEUE_BYTES + 1;
    session.sendText("a");
    socket.bufferedAmount = 0; // even if the queue were to read empty afterwards
    session.sendText("b");
    session.sendBinary(new Uint8Array([3]));

    expect(socket.sent).toEqual([]);
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({ via: "relay" });
  });

  it("never cuts off a socket that cannot report its queue", () => {
    const { socket, session } = setup();
    socket.bufferedAmount = undefined;
    session.sendText("a");
    expect(socket.sent).toEqual(["a"]);
    expect(socket.close).not.toHaveBeenCalled();
  });
});
