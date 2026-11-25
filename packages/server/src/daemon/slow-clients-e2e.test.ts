import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decodeFileTransferFrame } from "@av-pi-studio/protocol";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { WebSocket } from "ws";

import { FileTransferService } from "../files/file-transfer.js";
import { silentLogger, type Logger } from "../logging/logger.js";
import { MAX_SEND_QUEUE_BYTES } from "../ws/limits.js";
import { type Session } from "../ws/session.js";
import { createWebSocketServer, type WebSocketServerHandle } from "../ws/ws-server.js";
import { broadcast } from "./bootstrap.js";

/**
 * One client that does not read cannot grow the daemon's memory (sprint-154/task-003), against the
 * real direct WebSocket server over loopback: a broadcast reaches the client that reads, in order,
 * while the one that does not is cut off; a slow download is paced below the cap and completes.
 */

const MIB = 1024 * 1024;
const EVENTS = 100;

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.toReversed()) await fn();
  cleanups.length = 0;
});

async function startServer(): Promise<{
  handle: WebSocketServerHandle;
  port: number;
  warn: Mock;
  sessions: Session[];
}> {
  const warn = vi.fn();
  const logger: Logger = { ...silentLogger(), warn };
  const sessions: Session[] = [];
  const http: Server = createServer();
  const handle = createWebSocketServer(http, {
    serverId: "srv_slow",
    logger,
    onSession: (session) => sessions.push(session),
  });
  await once(http.listen(0, "127.0.0.1"), "listening");
  cleanups.push(async () => {
    await handle.close();
    http.close();
  });
  return { handle, port: (http.address() as AddressInfo).port, warn, sessions };
}

/** Connect, say hello and wait for the daemon's `status` reply. */
async function connect(port: number, clientId: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  cleanups.push(() => ws.terminate());
  await once(ws, "open");
  const status = once(ws, "message");
  ws.send(JSON.stringify({ type: "hello", clientId, clientType: "cli", protocolVersion: 1 }));
  await status;
  return ws;
}

describe("a client that stops reading", () => {
  it("is cut off during a 100 MiB broadcast while a second client receives every event in order", async () => {
    const { handle, port, warn } = await startServer();
    const slow = await connect(port, "slow");
    const [slowOnServer] = [...handle.wss.clients];
    slow.pause(); // stops reading the socket: the daemon's queue for it only grows
    const fast = await connect(port, "fast");

    const order: number[] = [];
    fast.on("message", (data: Buffer) => {
      const frame = JSON.parse(data.toString()) as { message: { i: number } };
      order.push(frame.message.i);
    });

    const pad = "x".repeat(MIB);
    for (let i = 0; i < EVENTS; i++) {
      const arrived = once(fast, "message");
      broadcast(handle.sessions, { type: "event", i, pad });
      await arrived; // the reading client keeps up, so only the one that does not read is at risk
    }

    if (slowOnServer!.readyState !== WebSocket.CLOSED) await once(slowOnServer!, "close");
    expect(order).toEqual(Array.from({ length: EVENTS }, (_, i) => i));
    expect(handle.sessions.size).toBe(1);
    expect(slowOnServer!.bufferedAmount).toBe(0); // the queue was released
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({ clientId: "slow" });
    expect(warn.mock.calls[0]![0].queuedBytes).toBeGreaterThan(MAX_SEND_QUEUE_BYTES);
  }, 60_000);

  it("still receives a download larger than the cap, whose own pacing keeps the queue below it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-studio-slow-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const size = 40 * MIB;
    const file = join(dir, "big.bin");
    await writeFile(file, Buffer.alloc(size, "d"));

    const { port, warn, sessions } = await startServer();
    const client = await connect(port, "downloader");
    const session = sessions[0]!;
    let received = 0;
    const ended = Promise.withResolvers<void>();
    client.on("message", (data: Buffer, isBinary: boolean) => {
      if (!isBinary) return;
      const frame = decodeFileTransferFrame(new Uint8Array(data));
      if (frame.opcode === "Chunk") received += frame.data.length;
      if (frame.opcode === "End") ended.resolve();
    });
    client.pause(); // a slow reader: the queue fills until the download pauses itself

    const svc = new FileTransferService({ drainPollMs: 1 });
    const { run } = await svc.beginDownload(session.id, { path: file, stream: 1 });
    let peak = 0;
    const finished = run!(
      (frame) => {
        session.sendBinary(frame);
        peak = Math.max(peak, session.bufferedAmount ?? 0);
      },
      { bufferedAmount: () => session.bufferedAmount, isOpen: () => session.isOpen },
    );
    await vi.waitFor(() => expect(session.bufferedAmount).toBeGreaterThan(0));
    client.resume();
    await Promise.all([finished, ended.promise]);

    expect(received).toBe(size);
    expect(peak).toBeLessThan(MAX_SEND_QUEUE_BYTES);
    expect(session.isOpen).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  }, 60_000);
});
