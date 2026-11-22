import { readFileSync } from "node:fs";
import { createConnection } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { acceptKey, encodeFrame, FrameParser, loadStatusFrame, StandInDaemon } from "./stand-in-daemon.mjs";

const FIXTURES = new URL("../../../../../packages/protocol/fixtures/external-clients/", import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"));

/** A client's masked frame (what a browser sends). */
function maskedFrame(opcode, payload, { fin = true } = {}) {
  const body = Buffer.from(payload);
  const key = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const masked = Buffer.from(body.map((byte, i) => byte ^ key[i % 4]));
  let header;
  if (body.length < 126) header = Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | body.length]);
  else if (body.length < 65_536) {
    header = Buffer.alloc(4);
    header[0] = (fin ? 0x80 : 0) | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = (fin ? 0x80 : 0) | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  return Buffer.concat([header, key, masked]);
}

describe("the frame codec", () => {
  it("computes the accept key of RFC 6455's example", () => {
    expect(acceptKey("dGhlIHNhbXBsZSBub25jZQ==")).toBe("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  });

  it("parses masked frames of every length class, split at any byte", () => {
    const payloads = ["hi", "x".repeat(200), "y".repeat(70_000)];
    const bytes = Buffer.concat(payloads.map((text) => maskedFrame(1, text)));
    for (const step of [1, 7, bytes.length]) {
      const parser = new FrameParser();
      const seen = [];
      for (let at = 0; at < bytes.length; at += step) seen.push(...parser.push(bytes.subarray(at, at + step)));
      expect(seen.map((frame) => frame.payload.toString())).toEqual(payloads);
    }
  });

  it("refuses a frame above its limit", () => {
    const header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(1n << 40n, 2);
    expect(() => new FrameParser().push(header)).toThrow("limit");
  });

  it("encodes unmasked frames that its own parser reads back", () => {
    const frames = new FrameParser().push(Buffer.concat([encodeFrame(1, "a"), encodeFrame(1, "b".repeat(300)), encodeFrame(8, Buffer.from([0x03, 0xe8]))]));
    expect(frames.map((frame) => [frame.opcode, frame.payload.length])).toEqual([[1, 1], [1, 300], [8, 2]]);
  });
});

describe("loadStatusFrame", () => {
  it("is the fixture's frame", () => {
    expect(loadStatusFrame()).toEqual(fixture("status.server_info.json").frame);
  });
});

describe("StandInDaemon", () => {
  const daemons = [];
  const clients = [];
  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    for (const daemon of daemons.splice(0)) await daemon.close();
  });

  async function start(options) {
    const daemon = await StandInDaemon.start(options);
    daemons.push(daemon);
    return daemon;
  }

  /** A client that has connected, and collects the messages it gets. */
  async function connect(daemon, protocols) {
    const socket = new WebSocket(daemon.url, protocols);
    clients.push(socket);
    const messages = [];
    const waiting = [];
    socket.addEventListener("message", (event) => {
      messages.push(event.data);
      waiting.shift()?.();
    });
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("the upgrade was refused")), { once: true });
    });
    const next = async () => {
      if (messages.length === 0) await new Promise((resolve) => waiting.push(resolve));
      return messages.shift();
    };
    return { socket, next };
  }

  it("answers the fixture's hello with the fixture's status frame", async () => {
    const daemon = await start();
    const { socket, next } = await connect(daemon);
    socket.send(JSON.stringify(fixture("hello.json").frame));
    expect(JSON.parse(await next())).toEqual(fixture("status.server_info.json").frame);
    expect(daemon.hellos).toEqual([fixture("hello.json").frame]);
    expect(daemon.upgrades).toEqual([{ authorized: true, offeredBearer: false, origin: null }]);
  });

  it("answers a ping with a pong that carries its request id", async () => {
    const daemon = await start();
    const { socket, next } = await connect(daemon);
    socket.send(JSON.stringify(fixture("ping.json").frame));
    const pong = JSON.parse(await next());
    expect(pong).toMatchObject({ type: "pong", requestId: "req-1", clientSentAt: 1767225600000 });
    expect(typeof pong.serverReceivedAt).toBe("number");
    expect(daemon.pings).toBe(1);
  });

  it("counts what it does not answer", async () => {
    const daemon = await start();
    const { socket, next } = await connect(daemon);
    socket.send(JSON.stringify({ type: "session", message: { type: "list_agents_request" } }));
    socket.send(new Uint8Array([1, 2, 3]));
    socket.send("not json");
    socket.send(JSON.stringify(fixture("ping.json").frame));
    await next();
    expect([...daemon.others]).toEqual([["session", 1], ["binary", 1], ["not-json", 1]]);
    expect(daemon.unanswered).toBe(3);
  });

  it("reads a message of 70,000 characters", async () => {
    const daemon = await start();
    const { socket, next } = await connect(daemon);
    socket.send(JSON.stringify({ ...fixture("hello.json").frame, clientId: "c".repeat(70_000) }));
    await next();
    expect(daemon.hellos[0].clientId).toHaveLength(70_000);
  });

  it("with a password: echoes the bearer subprotocol, and refuses a wrong or missing one with 401", async () => {
    const daemon = await start({ password: "s3cret" });
    const { socket } = await connect(daemon, ["pi-studio.bearer.s3cret"]);
    expect(socket.protocol).toBe("pi-studio.bearer.s3cret");
    await expect(connect(daemon, ["pi-studio.bearer.wrong"])).rejects.toThrow("refused");
    await expect(connect(daemon)).rejects.toThrow("refused");
    // (The client may repeat a refused upgrade: only the kinds are pinned.)
    const refused = daemon.upgrades.filter((upgrade) => !upgrade.authorized);
    expect(daemon.upgrades.filter((upgrade) => upgrade.authorized)).toHaveLength(1);
    expect(refused.some((upgrade) => upgrade.offeredBearer)).toBe(true);
    expect(refused.some((upgrade) => !upgrade.offeredBearer)).toBe(true);
    expect(JSON.stringify(daemon.upgrades)).not.toContain("s3cret");
  });

  it("answers a close with a close, and counts the connection open and closed", async () => {
    const daemon = await start();
    const { socket } = await connect(daemon);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(daemon.open).toBe(1);
    const closed = new Promise((resolve) => socket.addEventListener("close", (event) => resolve(event.code), { once: true }));
    socket.close(1000);
    expect(await closed).toBe(1000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(daemon.open).toBe(0);
  });

  it("joins a message sent in fragments", async () => {
    const daemon = await start();
    await new Promise((resolve, reject) => {
      const raw = createConnection({ host: "127.0.0.1", port: daemon.port });
      const text = JSON.stringify(fixture("hello.json").frame);
      let answered = "";
      raw.on("data", (chunk) => {
        answered += chunk;
        if (answered.includes("\r\n\r\n") && answered.split("\r\n\r\n")[1].length > 0) resolve();
      });
      raw.on("error", reject);
      raw.write(["GET / HTTP/1.1", `Host: 127.0.0.1:${daemon.port}`, "Upgrade: websocket", "Connection: Upgrade", "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version: 13", "", ""].join("\r\n"));
      raw.write(Buffer.concat([maskedFrame(1, text.slice(0, 10), { fin: false }), maskedFrame(0, text.slice(10), { fin: true })]));
      raw.once("close", () => {});
    });
    expect(daemon.hellos).toHaveLength(1);
  });
});
