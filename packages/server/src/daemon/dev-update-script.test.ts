import { afterEach, describe, expect, it } from "vitest";
import { type AddressInfo } from "node:net";
import { WebSocket } from "ws";

import { silentLogger } from "../logging/logger.js";
import { parseDevUpdateScript, type DevUpdateScript } from "../update/dev-update-script.js";
import { SERVER_VERSION } from "../version.js";
import { startDevDaemon, type DevBootstrapHandle } from "./dev-bootstrap.js";

/**
 * Dev daemon scripted self-update (`PI_STUDIO_DEV_UPDATE`, sprint-136/task-006): each script is
 * driven over a real socket and the pushed states are asserted in order. Port 0, no npm, no helper.
 */

type Message = Record<string, unknown>;

interface Client {
  ws: WebSocket;
  version: string | undefined;
  /** Every `daemon_update_status.status` pushed, in order. */
  pushed: Message[];
  closed: Promise<void>;
  rpc(message: Message): Promise<Message>;
}

let handle: DevBootstrapHandle | undefined;
const clients: WebSocket[] = [];

afterEach(async () => {
  for (const ws of clients.splice(0)) ws.terminate();
  await handle?.close();
  handle = undefined;
});

function boot(script: DevUpdateScript | null): Promise<number> {
  const dev = startDevDaemon({
    host: "127.0.0.1",
    port: 0,
    logger: silentLogger(),
    updateScript: script,
    updateStepMs: 5,
  });
  handle = dev;
  if (dev.httpServer.listening)
    return Promise.resolve((dev.httpServer.address() as AddressInfo).port);
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  dev.httpServer.once("listening", () => resolve((dev.httpServer.address() as AddressInfo).port));
  dev.httpServer.once("error", reject);
  return promise;
}

async function connect(port: number): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  clients.push(ws);
  const pending = new Map<string, (m: Message) => void>();
  const pushed: Message[] = [];
  const ready = Promise.withResolvers<string | undefined>();
  const closed = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  ws.once("open", () =>
    ws.send(
      JSON.stringify({ type: "hello", clientId: "c", clientType: "cli", protocolVersion: 1 }),
    ),
  );
  ws.on("message", (data: Buffer) => {
    const env = JSON.parse(data.toString("utf8"));
    if (env.type === "status") ready.resolve((env.payload as { version?: string }).version);
    if (env.type !== "session" || !env.message) return;
    if (env.message.type === "daemon_update_status") pushed.push(env.message.status);
    if (env.message.requestId) pending.get(env.message.requestId)?.(env.message);
  });
  ws.once("error", ready.reject);
  const version = await ready.promise;
  let n = 0;
  const rpc = (message: Message): Promise<Message> => {
    const requestId = `r${n++}`;
    const { promise, resolve } = Promise.withResolvers<Message>();
    pending.set(requestId, resolve);
    ws.send(JSON.stringify({ type: "session", message: { ...message, requestId } }));
    return promise;
  };
  return { ws, version, pushed, closed, rpc };
}

async function status(client: Client): Promise<Message> {
  const res = await client.rpc({ type: "daemon_update_status_request" });
  return res.status as Message;
}

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 400; i++) {
    const v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("until: timed out");
}

const kinds = (client: Client): string[] =>
  client.pushed.map((s) => (s.state as { kind: string }).kind);

describe("parseDevUpdateScript", () => {
  it("accepts the four scripts, treats unset/empty as none, rejects the rest", () => {
    expect(parseDevUpdateScript(undefined)).toBeUndefined();
    expect(parseDevUpdateScript("")).toBeUndefined();
    expect(parseDevUpdateScript("rollback")).toBe("rollback");
    expect(() => parseDevUpdateScript("nope")).toThrow(/PI_STUDIO_DEV_UPDATE/);
  });
});

describe("dev daemon scripted update (sprint-136/task-006)", () => {
  it("unscripted: kind source, nothing newer", async () => {
    const client = await connect(await boot(null));
    const s = await until(
      () => status(client),
      (v) => v.checkedAt !== undefined,
    );
    expect(s.installKind).toBe("source");
    expect(s.currentVersion).toBe(SERVER_VERSION);
    expect(s.state).toEqual({ kind: "idle" });
  });

  it("available: walks the steps, drops sockets, returns as 9.9.9 on the same port", async () => {
    const port = await boot("available");
    const client = await connect(port);
    const before = await until(
      () => status(client),
      (v) => (v.state as { kind: string }).kind === "available",
    );
    expect(before.state).toEqual({ kind: "available", version: "9.9.9" });
    expect(client.version).toBe(SERVER_VERSION);

    expect(await client.rpc({ type: "daemon_update_apply_request" })).toMatchObject({ ok: true });
    await client.closed;
    expect(kinds(client).slice(-3)).toEqual(["installing", "updating_extensions", "restarting"]);

    const again = await connect(port);
    expect(again.version).toBe("9.9.9");
    const after = await status(again);
    expect(after).toMatchObject({
      currentVersion: "9.9.9",
      state: { kind: "idle" },
      lastResult: { from: SERVER_VERSION, to: "9.9.9", outcome: "updated" },
    });
    // The handshake push carries the same status.
    await until(
      async () => again.pushed.length,
      (n) => n > 0,
    );
    expect(again.pushed[0]).toMatchObject({ currentVersion: "9.9.9" });
  });

  it("rollback: same walk, old version, rolled_back result", async () => {
    const port = await boot("rollback");
    const client = await connect(port);
    await until(
      () => status(client),
      (v) => (v.state as { kind: string }).kind === "available",
    );
    await client.rpc({ type: "daemon_update_apply_request" });
    await client.closed;
    expect(kinds(client).slice(-3)).toEqual(["installing", "updating_extensions", "restarting"]);

    const again = await connect(port);
    expect(again.version).toBe(SERVER_VERSION);
    expect(await status(again)).toMatchObject({
      currentVersion: SERVER_VERSION,
      lastResult: { from: SERVER_VERSION, to: "9.9.9", outcome: "rolled_back" },
    });
  });

  it("fail: apply ends in failed(permission) and the socket stays", async () => {
    const client = await connect(await boot("fail"));
    await until(
      () => status(client),
      (v) => (v.state as { kind: string }).kind === "available",
    );
    await client.rpc({ type: "daemon_update_apply_request" });
    const s = await until(
      () => status(client),
      (v) => (v.state as { kind: string }).kind === "failed",
    );
    expect(s.state).toMatchObject({ kind: "failed", version: "9.9.9", code: "permission" });
    expect(kinds(client)).toContain("installing");
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("cannot: cannot_update(not_writable, 9.9.9) and apply is refused", async () => {
    const client = await connect(await boot("cannot"));
    const s = await until(
      () => status(client),
      (v) => (v.state as { kind: string }).kind === "cannot_update",
    );
    expect(s.state).toMatchObject({
      kind: "cannot_update",
      reason: "not_writable",
      version: "9.9.9",
    });
    expect(await client.rpc({ type: "daemon_update_apply_request" })).toMatchObject({
      ok: false,
      error: "cannot_update",
    });
  });
});
