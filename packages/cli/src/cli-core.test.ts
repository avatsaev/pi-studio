import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Transport } from "@av-pi-studio/client";

import { resolveClientId } from "./client-id.js";
import {
  type CliContext,
  EXIT_CONNECTION,
  EXIT_ERROR,
  EXIT_OK,
  formatOf,
  runRpc,
  withDaemon,
} from "./cli-core.js";
import { connectDaemon, hostToUrl, parseHost } from "./connection.js";
import { renderJson, renderObject, renderTable } from "./output.js";

// ─── Scripted fake daemon transport ────────────────────────────────────────────

interface FakeOptions {
  /** Map of request `type` → response payload, or a function to compute it. */
  responses?: Record<string, unknown | ((msg: Record<string, unknown>) => unknown)>;
  /** Request types that should reply with an rpc_error. */
  rpcErrors?: Record<string, { message: string; code?: string }>;
  /** When true, never reply to hello (handshake hangs / used with short timeout). */
  failHandshake?: boolean;
  /** When true, the transport.connect() rejects (socket-level failure). */
  failConnect?: boolean;
  /** Capture the hello frame. */
  onHello?: (hello: Record<string, unknown>) => void;
}

function makeFakeTransport(options: FakeOptions = {}): { transport: Transport; sent: string[] } {
  const sent: string[] = [];
  let open = false;

  const transport: Transport = {
    onMessage: null,
    onClose: null,
    onError: null,
    get isOpen() {
      return open;
    },
    connect: () => {
      if (options.failConnect) return Promise.reject(new Error("ECONNREFUSED"));
      open = true;
      return Promise.resolve();
    },
    sendText: (data) => {
      sent.push(data);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(data) as Record<string, unknown>;
      } catch {
        return;
      }
      if (parsed.type === "hello") {
        options.onHello?.(parsed);
        if (!options.failHandshake) {
          queueMicrotask(() => transport.onMessage?.(serverInfoFrame()));
        }
        return;
      }
      if (parsed.type === "session") {
        const msg = parsed.message as Record<string, unknown>;
        const reqType = msg.type as string;
        const requestId = msg.requestId as string;
        const err = options.rpcErrors?.[reqType];
        if (err) {
          queueMicrotask(() =>
            transport.onMessage?.(
              JSON.stringify({
                type: "session",
                message: { type: "rpc_error", requestId, message: err.message, code: err.code },
              }),
            ),
          );
          return;
        }
        const r = options.responses?.[reqType];
        const payload =
          typeof r === "function" ? (r as (m: Record<string, unknown>) => unknown)(msg) : r;
        queueMicrotask(() =>
          transport.onMessage?.(
            JSON.stringify({
              type: "session",
              message: { type: `${reqType}_response`, requestId, payload: payload ?? {} },
            }),
          ),
        );
      }
    },
    sendBinary: () => {},
    close: () => {
      open = false;
      transport.onClose?.(1000, "");
    },
  };
  return { transport, sent };
}

function serverInfoFrame(): string {
  return JSON.stringify({
    type: "status",
    payload: {
      status: "server_info",
      serverId: "srv-test",
      version: "9.9.9",
      capabilities: {},
      features: {},
    },
  });
}

function fakeContext(options: FakeOptions = {}): {
  ctx: CliContext;
  out: string[];
  err: string[];
  sent: string[];
} {
  const { transport, sent } = makeFakeTransport(options);
  const out: string[] = [];
  const err: string[] = [];
  const ctx: CliContext = {
    connect: (opts) => connectDaemon(opts),
    sink: { write: (l) => out.push(l), error: (l) => err.push(l) },
    rpcTimeoutMs: 50,
    connectOverrides: { transport, clientId: "cli-test-id" },
  };
  return { ctx, out, err, sent };
}

// ─── parseHost ───────────────────────────────────────────────────────────────

describe("parseHost", () => {
  it("defaults to the local daemon when no host is given", () => {
    expect(parseHost()).toEqual({ host: "127.0.0.1", port: 6767, explicit: false });
    expect(parseHost("")).toEqual({ host: "127.0.0.1", port: 6767, explicit: false });
  });

  it("parses host:port", () => {
    expect(parseHost("workstation.local:6767")).toEqual({
      host: "workstation.local",
      port: 6767,
      explicit: true,
    });
  });

  it("parses a bare host with the default port", () => {
    expect(parseHost("example.com")).toEqual({ host: "example.com", port: 6767, explicit: true });
  });

  it("strips ws:// and wss:// schemes", () => {
    expect(parseHost("ws://h:1234")).toEqual({ host: "h", port: 1234, explicit: true });
    expect(hostToUrl(parseHost("h:1234"))).toBe("ws://h:1234");
  });
});

// ─── client-id persistence ─────────────────────────────────────────────────────

describe("resolveClientId", () => {
  it("persists a stable id under $PI_STUDIO_HOME and reuses it", () => {
    const home = mkdtempSync(join(tmpdir(), "pi-cli-id-"));
    const first = resolveClientId(home);
    const second = resolveClientId(home);
    expect(first).toBe(second);
    expect(first.startsWith("cli-")).toBe(true);
    expect(readFileSync(join(home, "cli-client-id"), "utf8").trim()).toBe(first);
  });
});

// ─── output rendering ───────────────────────────────────────────────────────────

describe("output rendering", () => {
  it("renders a table per flag", () => {
    const table = renderTable(
      [
        { id: "a1", status: "running" },
        { id: "b2", status: "idle" },
      ],
      ["id", "status"],
    );
    expect(table).toContain("ID");
    expect(table).toContain("a1");
    expect(table).toContain("running");
    expect(table.split("\n")).toHaveLength(3); // header + 2 rows
  });

  it("renders json per flag", () => {
    expect(JSON.parse(renderJson({ a: 1 }))).toEqual({ a: 1 });
  });

  it("renders an empty table sentinel", () => {
    expect(renderTable([])).toBe("(no results)");
  });

  it("renders an object as key/value lines", () => {
    const text = renderObject({ id: "x", title: "hi" });
    expect(text).toContain("id");
    expect(text).toContain("x");
  });

  it("formatOf reflects the --json flag", () => {
    expect(formatOf({})).toBe("table");
    expect(formatOf({ json: true })).toBe("json");
  });
});

// ─── connection + dispatch ──────────────────────────────────────────────────────

describe("withDaemon / runRpc", () => {
  it("connects, completes the hello handshake with a stable clientId", async () => {
    let hello: Record<string, unknown> | undefined;
    const { ctx } = fakeContext({ onHello: (h) => (hello = h) });
    const code = await withDaemon(ctx, {}, (_client, _ctx, _opts) => EXIT_OK);
    expect(code).toBe(EXIT_OK);
    expect(hello?.type).toBe("hello");
    expect(hello?.clientId).toBe("cli-test-id");
    expect(hello?.clientType).toBe("cli");
  });

  it("dispatches an RPC and renders the payload (json)", async () => {
    const { ctx, out } = fakeContext({
      responses: { list_agents: { agents: [{ id: "a1" }] } },
    });
    const code = await runRpc(ctx, { json: true }, "list_agents", {}, () => "");
    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(out[0]!)).toEqual({ agents: [{ id: "a1" }] });
  });

  it("dispatches an RPC and renders a table (default)", async () => {
    const { ctx, out } = fakeContext({
      responses: { list_agents: { agents: [] } },
    });
    const code = await runRpc(ctx, {}, "list_agents", {}, () => "RENDERED-TABLE");
    expect(code).toBe(EXIT_OK);
    expect(out[0]).toBe("RENDERED-TABLE");
  });

  it("surfaces rpc_error with a nonzero exit code", async () => {
    const { ctx, err } = fakeContext({
      rpcErrors: { stop_agent: { message: "no such agent", code: "not_found" } },
    });
    const code = await runRpc(ctx, {}, "stop_agent", { agentId: "nope" }, () => "");
    expect(code).toBe(EXIT_ERROR);
    expect(err.join("\n")).toContain("no such agent");
    expect(err.join("\n")).toContain("not_found");
  });

  it("returns a connection exit code when the socket fails to connect", async () => {
    const { ctx, err } = fakeContext({ failConnect: true });
    const code = await withDaemon(ctx, {}, () => EXIT_OK);
    expect(code).toBe(EXIT_CONNECTION);
    expect(err.join("\n")).toContain("connection error");
  });
});
