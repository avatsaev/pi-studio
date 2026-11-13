import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";

/**
 * Shared raw-`ws` client for daemon-level tests and the external-fixture recorder (sprint-083).
 * Speaks the wire protocol directly (hello → `status`, `{type:"session",message}` envelopes with a
 * stamped `requestId`) so a test sees exactly what an external client sees. Not part of the
 * daemon's runtime surface; exported only for tests/scripts.
 */

/** One top-level frame exactly as received: `status`, `pong`, `{type:"session",message}`, … */
export type WireFrame = Record<string, unknown>;

export interface TestClientOptions {
  clientType?: string;
  appVersion?: string;
  capabilities?: Record<string, boolean>;
}

export interface TestClient {
  ws: WebSocket;
  /** Every top-level frame received so far, in arrival order (the handshake `status` first). */
  frames: WireFrame[];
  /** The handshake `status` frame. */
  status: WireFrame;
  /** Sends a raw top-level frame as JSON. */
  send(frame: WireFrame): void;
  /** Sends `{type:"session",message:{...body,type,requestId}}` and resolves with the full reply
   *  frame correlated by `requestId` (rejects after 4 s). */
  rpcFrame(type: string, body?: WireFrame): Promise<WireFrame>;
  /** Like `rpcFrame`, resolving with the inner session message. */
  rpc(type: string, body?: WireFrame): Promise<WireFrame>;
  /** Polls the frame log for the first frame matching `predicate` (default 4 s timeout). */
  waitFor(predicate: (frame: WireFrame) => boolean, timeoutMs?: number): Promise<WireFrame>;
  close(): Promise<void>;
}

export const RPC_TIMEOUT_MS = 4000;

/** The session message inside a `{type:"session",message}` frame; any other frame is its own
 *  message (`status`, `pong`, …). */
export function messageOf(frame: WireFrame): WireFrame {
  return frame.type === "session" ? (frame.message as WireFrame) : frame;
}

/**
 * The port the OS assigned to `server`. Every dev daemon in tests binds `port: 0` and learns its
 * port here; guessing from a fixed range collides across vitest's parallel processes.
 */
export function listeningPort(server: Server): Promise<number> {
  if (server.listening) return Promise.resolve((server.address() as AddressInfo).port);
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  server.once("listening", () => resolve((server.address() as AddressInfo).port));
  server.once("error", reject);
  return promise;
}

export async function connectTestClient(
  port: number,
  options: TestClientOptions = {},
): Promise<TestClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const frames: WireFrame[] = [];
  const replies = new Map<string, (frame: WireFrame) => void>();
  const handshake = Promise.withResolvers<WireFrame>();

  ws.once("error", handshake.reject);
  ws.on("message", (data: Buffer) => {
    const frame = JSON.parse(data.toString("utf8")) as WireFrame;
    frames.push(frame);
    const requestId = messageOf(frame).requestId;
    if (typeof requestId === "string") replies.get(requestId)?.(frame);
    if (frame.type === "status") handshake.resolve(frame);
  });
  ws.once("open", () => {
    ws.send(
      JSON.stringify({
        type: "hello",
        clientId: `test-${randomUUID()}`,
        clientType: options.clientType ?? "cli",
        protocolVersion: 1,
        ...(options.appVersion !== undefined ? { appVersion: options.appVersion } : {}),
        ...(options.capabilities !== undefined ? { capabilities: options.capabilities } : {}),
      }),
    );
  });
  const status = await handshake.promise;

  const waitFor = async (
    predicate: (frame: WireFrame) => boolean,
    timeoutMs = RPC_TIMEOUT_MS,
  ): Promise<WireFrame> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = frames.find(predicate);
      if (found) return found;
      if (Date.now() > deadline) throw new Error("waitFor: timed out waiting for a matching frame");
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  };

  const rpcFrame = (type: string, body: WireFrame = {}): Promise<WireFrame> => {
    const requestId = `req-${randomUUID()}`;
    const { promise, resolve, reject } = Promise.withResolvers<WireFrame>();
    const timer = setTimeout(() => {
      replies.delete(requestId);
      reject(new Error(`rpc timeout: ${type}`));
    }, RPC_TIMEOUT_MS);
    replies.set(requestId, (frame) => {
      clearTimeout(timer);
      replies.delete(requestId);
      resolve(frame);
    });
    ws.send(JSON.stringify({ type: "session", message: { ...body, type, requestId } }));
    return promise;
  };

  return {
    ws,
    frames,
    status,
    send: (frame) => ws.send(JSON.stringify(frame)),
    rpcFrame,
    rpc: async (type, body) => messageOf(await rpcFrame(type, body)),
    waitFor,
    close: async () => {
      if (ws.readyState === WebSocket.CLOSED) return;
      const closed = Promise.withResolvers<void>();
      ws.once("close", () => closed.resolve());
      ws.close();
      await closed.promise;
    },
  };
}
