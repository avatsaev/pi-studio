// The app's control socket (`desktop/docs/control-protocol.md`): JSON lines over loopback TCP.
// The first line authenticates; each request line gets one reply line carrying the request's id.

import { createConnection } from "node:net";

const LISTENING = /control server listening on [\d.]+:(\d+)/;
const CONFIG_DIR = /configuration directory: (.+)/;

/** The port the app bound, from its standard error; `null` while it has not said. */
export function parseControlPort(log) {
  const match = LISTENING.exec(log);
  return match ? Number(match[1]) : null;
}

/** The configuration directory the app says it uses, from its standard error. */
export function parseConfigDir(log) {
  const match = CONFIG_DIR.exec(log);
  return match ? match[1].trim() : null;
}

export class ControlClient {
  #socket;
  #buffer = "";
  #pending = new Map();
  #nextId = 1;
  #closed = null;
  /** Every reply line received, verbatim: what a check scans for a secret. */
  replies = [];

  constructor(socket) {
    this.#socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => this.#onData(chunk));
    socket.on("close", () => this.#onClose(new Error("the control socket closed")));
    socket.on("error", (error) => this.#onClose(error));
  }

  /** Connect to `127.0.0.1:port` and authenticate with `token`. */
  static async connect({ port, token }) {
    const socket = createConnection({ host: "127.0.0.1", port });
    await new Promise((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    const client = new ControlClient(socket);
    await client.call("auth", { token }, { id: "auth" });
    return client;
  }

  #onData(chunk) {
    this.#buffer += chunk;
    for (let end = this.#buffer.indexOf("\n"); end !== -1; end = this.#buffer.indexOf("\n")) {
      const line = this.#buffer.slice(0, end);
      this.#buffer = this.#buffer.slice(end + 1);
      if (line.trim() !== "") this.#onLine(line);
    }
  }

  #onLine(line) {
    this.replies.push(line);
    let reply;
    try {
      reply = JSON.parse(line);
    } catch {
      return;
    }
    const waiting = this.#pending.get(reply.id);
    if (!waiting) return;
    this.#pending.delete(reply.id);
    clearTimeout(waiting.timer);
    if (reply.ok) waiting.resolve(reply.result);
    else waiting.reject(new Error(`${waiting.method}: ${String(reply.error)}`));
  }

  #onClose(error) {
    this.#closed ??= error;
    for (const waiting of this.#pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(this.#closed);
    }
    this.#pending.clear();
  }

  /** Send one request and resolve with its `result`; reject with the reply's `error`. */
  call(method, params = {}, { timeoutMs = 60_000, id = this.#nextId++ } = {}) {
    if (this.#closed) return Promise.reject(this.#closed);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method}: no reply in ${timeoutMs} ms`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer, method });
      this.#socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  /** Run an engine command by id. */
  execute(command, params) {
    return this.call("engine.execute", params === undefined ? { command } : { command, params });
  }

  /** The view: `{ ui, settings, daemons, menus }`. */
  inspect() {
    return this.call("ui.inspect");
  }

  close() {
    this.#socket.destroy();
  }
}
