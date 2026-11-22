// A stand-in for a daemon, for the Windows job, where no daemon runs (the daemon is POSIX-only).
// It speaks just enough of the protocol for the page to connect: it answers a client's `hello` with
// the `status` frame of `packages/protocol/fixtures/external-clients/status.server_info.json`, and
// a JSON `ping` with a `pong`; every other frame is counted and not answered. It reads the bearer
// password from the WebSocket subprotocol as the daemon does (`pi-studio.bearer.<password>`) and
// echoes it back, since the app's dial fails an upgrade whose offered subprotocol is not answered.
//
// No dependency: `node:http` for the upgrade and a small WebSocket framing of its own, because the
// Windows job installs only the desktop frontend's packages (not `ws`). Nothing here is a general
// WebSocket server: one text message at a time, no extensions, no compression.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const BEARER_PREFIX = "pi-studio.bearer.";
/** The largest message the stand-in accepts (a frame above it ends the connection). */
const MAX_MESSAGE = 16 * 1024 * 1024;

const OP = { continuation: 0, text: 1, binary: 2, close: 8, ping: 9, pong: 10 };

const STATUS_FIXTURE = new URL("../../../../../packages/protocol/fixtures/external-clients/status.server_info.json", import.meta.url);

/** The `frame` of the protocol fixture a daemon answers `hello` with. */
export function loadStatusFrame(file = STATUS_FIXTURE) {
  const fixture = JSON.parse(readFileSync(file, "utf8"));
  if (fixture.frame?.type !== "status" || fixture.frame?.payload?.status !== "server_info") {
    throw new Error(`${file} does not hold a status/server_info frame`);
  }
  return fixture.frame;
}

/** The `Sec-WebSocket-Accept` value for a client's `Sec-WebSocket-Key`. */
export function acceptKey(key) {
  return createHash("sha1").update(key + GUID).digest("base64");
}

/** One unmasked (server to client) frame. */
export function encodeFrame(opcode, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, body.length]);
  } else if (body.length < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  return Buffer.concat([header, body]);
}

/** The frames in a stream of client bytes, as they complete. Masked or not. */
export class FrameParser {
  #buffer = Buffer.alloc(0);

  /** Add bytes; returns the frames now complete: `{ fin, opcode, payload }`. Throws on a frame above the limit. */
  push(chunk) {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    const frames = [];
    for (;;) {
      const frame = this.#next();
      if (!frame) return frames;
      frames.push(frame);
    }
  }

  #next() {
    const buffer = this.#buffer;
    if (buffer.length < 2) return null;
    const fin = (buffer[0] & 0x80) !== 0;
    const opcode = buffer[0] & 0x0f;
    const masked = (buffer[1] & 0x80) !== 0;
    let length = buffer[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < 4) return null;
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buffer.length < 10) return null;
      const wide = buffer.readBigUInt64BE(2);
      if (wide > BigInt(MAX_MESSAGE)) throw new Error(`a frame of ${wide} bytes is above the stand-in's limit`);
      length = Number(wide);
      offset = 10;
    }
    if (length > MAX_MESSAGE) throw new Error(`a frame of ${length} bytes is above the stand-in's limit`);
    const mask = masked ? offset + 4 : offset;
    if (buffer.length < mask + length) return null;
    const payload = Buffer.from(buffer.subarray(mask, mask + length));
    if (masked) {
      const key = buffer.subarray(offset, offset + 4);
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= key[i % 4];
    }
    this.#buffer = buffer.subarray(mask + length);
    return { fin, opcode, payload };
  }
}

/** The protocols a request offers, from its `Sec-WebSocket-Protocol` header. */
function offeredProtocols(request) {
  return String(request.headers["sec-websocket-protocol"] ?? "")
    .split(",")
    .map((protocol) => protocol.trim())
    .filter(Boolean);
}

export class StandInDaemon {
  /** One per upgrade the stand-in saw: `{ authorized, offeredBearer, origin }`. Never the password. */
  upgrades = [];
  /** The `hello` frames received (parsed). */
  hellos = [];
  /** JSON `ping` frames answered with a `pong`. */
  pings = 0;
  /** Count of the other frames' `type` values (and `"binary"` for binary messages). */
  others = new Map();
  /** Connections that are open now. */
  open = 0;

  #server;
  #sockets = new Set();
  #password;
  #statusFrame;

  constructor({ password, statusFrame }) {
    this.#password = password;
    this.#statusFrame = statusFrame;
    this.#server = createServer((request, response) => {
      response.writeHead(426, { "Content-Type": "text/plain" });
      response.end("a WebSocket is needed here\n");
    });
    this.#server.on("upgrade", (request, socket, head) => this.#upgrade(request, socket, head));
  }

  /**
   * Listen on a free loopback port. With a `password`, an upgrade has to offer the bearer
   * subprotocol for it, or it gets a 401 (the daemon's rule).
   */
  static async start({ password = null, statusFrame = loadStatusFrame() } = {}) {
    const daemon = new StandInDaemon({ password, statusFrame });
    await new Promise((resolve, reject) => {
      daemon.#server.once("error", reject);
      daemon.#server.listen(0, "127.0.0.1", resolve);
    });
    return daemon;
  }

  get port() {
    return this.#server.address().port;
  }

  /** What a direct entry's address is. */
  get url() {
    return `ws://127.0.0.1:${this.port}`;
  }

  /** Every frame, of every type, the page sent that the stand-in did not answer. */
  get unanswered() {
    return [...this.others.values()].reduce((sum, count) => sum + count, 0);
  }

  #upgrade(request, socket, head) {
    const key = request.headers["sec-websocket-key"];
    const protocols = offeredProtocols(request);
    const bearer = protocols.find((protocol) => protocol.startsWith(BEARER_PREFIX));
    const authorized = this.#password === null || bearer === `${BEARER_PREFIX}${this.#password}`;
    this.upgrades.push({ authorized, offeredBearer: bearer !== undefined, origin: request.headers.origin ?? null });
    if (String(request.headers.upgrade).toLowerCase() !== "websocket" || typeof key !== "string") {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return;
    }
    if (!authorized) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    const lines = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      ...(bearer === undefined ? [] : [`Sec-WebSocket-Protocol: ${bearer}`]),
    ];
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    this.#serve(socket, head);
  }

  #serve(socket, head) {
    this.#sockets.add(socket);
    this.open += 1;
    const parser = new FrameParser();
    let fragments = null;
    const send = (opcode, payload) => {
      if (!socket.destroyed) socket.write(encodeFrame(opcode, payload));
    };
    const message = (text) => {
      let frame;
      try {
        frame = JSON.parse(text);
      } catch {
        this.others.set("not-json", (this.others.get("not-json") ?? 0) + 1);
        return;
      }
      switch (frame?.type) {
        case "hello":
          this.hellos.push(frame);
          send(OP.text, JSON.stringify(this.#statusFrame));
          return;
        case "ping": {
          this.pings += 1;
          const now = Date.now();
          send(OP.text, JSON.stringify({ type: "pong", requestId: frame.requestId, clientSentAt: frame.clientSentAt, serverReceivedAt: now, serverSentAt: now }));
          return;
        }
        default:
          this.others.set(String(frame?.type), (this.others.get(String(frame?.type)) ?? 0) + 1);
      }
    };
    const onFrame = ({ fin, opcode, payload }) => {
      switch (opcode) {
        case OP.ping:
          send(OP.pong, payload);
          return;
        case OP.pong:
          return;
        case OP.close:
          send(OP.close, payload.subarray(0, 2));
          socket.end();
          return;
        case OP.binary:
          this.others.set("binary", (this.others.get("binary") ?? 0) + 1);
          return;
        case OP.text:
          fragments = fin ? null : [payload];
          if (fin) message(payload.toString("utf8"));
          return;
        case OP.continuation:
          if (!fragments) return;
          fragments.push(payload);
          if (fin) {
            const text = Buffer.concat(fragments).toString("utf8");
            fragments = null;
            message(text);
          }
          return;
        default:
          socket.destroy();
      }
    };
    const feed = (chunk) => {
      try {
        for (const frame of parser.push(chunk)) onFrame(frame);
      } catch {
        socket.destroy();
      }
    };
    socket.on("data", feed);
    socket.on("error", () => {});
    socket.on("close", () => {
      this.#sockets.delete(socket);
      this.open -= 1;
    });
    if (head.length > 0) feed(head);
  }

  /** Stop listening and end every connection. */
  async close() {
    for (const socket of this.#sockets) socket.destroy();
    await new Promise((resolve) => this.#server.close(resolve));
  }
}
