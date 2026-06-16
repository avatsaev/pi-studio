import { describe, expect, it } from "vitest";

import type { Transport } from "@av-pi-studio/client";

import { buildProgram, globalOptions, run } from "./program.js";
import { type CliContext } from "./cli-core.js";
import { connectDaemon } from "./connection.js";

function fakeAgentCtx(agentId: string): { ctx: CliContext; out: string[] } {
  let open = false;
  const out: string[] = [];
  const transport: Transport = {
    onMessage: null,
    onClose: null,
    onError: null,
    get isOpen() {
      return open;
    },
    connect: () => {
      open = true;
      return Promise.resolve();
    },
    sendText: (data) => {
      const parsed = JSON.parse(data) as Record<string, unknown>;
      if (parsed.type === "hello") {
        queueMicrotask(() =>
          transport.onMessage?.(
            JSON.stringify({
              type: "status",
              payload: { status: "server_info", serverId: "s", capabilities: {}, features: {} },
            }),
          ),
        );
        return;
      }
      if (parsed.type === "session") {
        const msg = parsed.message as Record<string, unknown>;
        queueMicrotask(() =>
          transport.onMessage?.(
            JSON.stringify({
              type: "session",
              message: { type: "x_response", requestId: msg.requestId, payload: { agentId } },
            }),
          ),
        );
      }
    },
    sendBinary: () => {},
    close: () => {
      open = false;
    },
  };
  const ctx: CliContext = {
    connect: (opts) => connectDaemon(opts),
    sink: { write: (l) => out.push(l), error: () => {} },
    rpcTimeoutMs: 50,
    connectOverrides: { transport, clientId: "cli-test" },
  };
  return { ctx, out };
}

function safeCtx(): CliContext {
  // A neutralized context for option-parsing tests: the default root action (onboard) must not
  // spawn a real daemon or hit the network. probe→true short-circuits to pairing, which then
  // no-ops (no keypair in this empty home).
  return {
    connect: (opts) => connectDaemon(opts),
    sink: { write: () => {}, error: () => {} },
    daemon: {
      probe: async () => true,
      hash: (p) => p,
      kill: () => true,
      start: async () => 0,
    },
    connectOverrides: { home: "/nonexistent-pi-studio-home-for-tests" },
  };
}

describe("program", () => {
  it("parses global options (host/password/json)", () => {
    const program = buildProgram(safeCtx(), () => {});
    program.parse(["--host", "example.com:6767", "--password", "secret", "--json"], {
      from: "user",
    });
    const opts = globalOptions(program);
    expect(opts.host).toBe("example.com:6767");
    expect(opts.password).toBe("secret");
    expect(opts.json).toBe(true);
  });

  it("defaults json to false", () => {
    const program = buildProgram(safeCtx(), () => {});
    program.parse([], { from: "user" });
    expect(globalOptions(program).json).toBe(false);
  });

  it("run returns 0 for --help without throwing", async () => {
    // exitOverride makes help throw; run() maps it to success and swallows the output.
    const code = await run(["--help"]);
    expect(code).toBe(0);
  });

  it("run returns nonzero for an unknown option", async () => {
    const code = await run(["--definitely-not-an-option"]);
    expect(code).not.toBe(0);
  });

  it("dispatches the top-level `run` command end-to-end", async () => {
    const { ctx, out } = fakeAgentCtx("agent-xyz");
    const code = await run(["run", "build the thing", "--provider", "pi/m"], ctx);
    expect(code).toBe(0);
    expect(out[0]).toBe("agent-xyz");
  });

  it("routes the bare `pi-studio <path>` form to open-project", async () => {
    const { ctx, out } = fakeAgentCtx("");
    const code = await run(["/home/me/proj"], ctx);
    expect(code).toBe(0);
    // open_project_response payload was {agentId:""}; rendered as an object → non-empty output.
    expect(out.length).toBeGreaterThan(0);
  });

  it("dispatches `provider ls` through the feature group", async () => {
    const { ctx } = fakeAgentCtx("");
    const code = await run(["provider", "ls"], ctx);
    expect(code).toBe(0);
  });
});
