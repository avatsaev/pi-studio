import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

import { DaemonClient, WORKTREE_TIMEOUT_MS, type Transport } from "@av-pi-studio/client";

import { type CliContext, connectOptionsFrom } from "./cli-core.js";
import { connectDaemon } from "./connection.js";
import {
  FEATURE_RPC,
  featureRpc,
  registerFeatureCommands,
  runOpenProject,
} from "./feature-commands.js";

interface FakeOptions {
  responses?: Record<string, unknown>;
}

function makeFake(options: FakeOptions = {}): {
  transport: Transport;
  requests: Array<{ type: string; msg: Record<string, unknown> }>;
} {
  const requests: Array<{ type: string; msg: Record<string, unknown> }> = [];
  let open = false;
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
      const msg = (parsed.message as Record<string, unknown>) ?? {};
      const reqType = msg.type as string;
      requests.push({ type: reqType, msg });
      queueMicrotask(() =>
        transport.onMessage?.(
          JSON.stringify({
            type: "session",
            message: {
              type: `${reqType}_response`,
              requestId: msg.requestId,
              payload: options.responses?.[reqType] ?? {},
            },
          }),
        ),
      );
    },
    sendBinary: () => {},
    close: () => {
      open = false;
    },
  };
  return { transport, requests };
}

async function harness(options: FakeOptions = {}): Promise<{
  client: DaemonClient;
  ctx: CliContext;
  out: string[];
  requests: Array<{ type: string; msg: Record<string, unknown> }>;
}> {
  const { transport, requests } = makeFake(options);
  const out: string[] = [];
  const ctx: CliContext = {
    connect: (opts) => connectDaemon(opts),
    sink: { write: (l) => out.push(l), error: () => {} },
    rpcTimeoutMs: 50,
    connectOverrides: { transport, clientId: "cli-test" },
  };
  const { client } = await ctx.connect(connectOptionsFrom(ctx, {}));
  return { client, ctx, out, requests };
}

describe("feature commands — one round-trip per group", () => {
  it("terminal capture sends slot and returns text", async () => {
    const { ctx, out, requests } = await harness({
      responses: { [FEATURE_RPC.terminalCapture]: { text: "screen contents" } },
    });
    const code = await featureRpc(ctx, {}, FEATURE_RPC.terminalCapture, { slot: 2 }, (p) =>
      String((p as { text?: string }).text ?? ""),
    );
    expect(code).toBe(0);
    expect(out[0]).toBe("screen contents");
    expect(requests[0]!.msg.slot).toBe(2);
  });

  it("provider ls maps to list_providers", async () => {
    const { ctx, out, requests } = await harness({
      responses: {
        [FEATURE_RPC.providerList]: { providers: [{ providerId: "pi", available: true }] },
      },
    });
    await featureRpc(ctx, {}, FEATURE_RPC.providerList, {}, (p) =>
      JSON.stringify((p as { providers: unknown[] }).providers),
    );
    expect(requests[0]!.type).toBe("list_providers");
    expect(out[0]).toContain("pi");
  });

  it("worktree create maps to the registered worktree RPC", async () => {
    const { ctx, requests } = await harness({ responses: { [FEATURE_RPC.worktreeCreate]: {} } });
    await featureRpc(ctx, {}, FEATURE_RPC.worktreeCreate, { name: "feature-x" }, () => "");
    expect(requests[0]!.type).toBe("create_pistudio_worktree_request");
    expect(requests[0]!.msg.name).toBe("feature-x");
  });

  it("runOpenProject maps to open_project_request with the path", async () => {
    const { ctx, requests } = await harness({ responses: { [FEATURE_RPC.openProject]: {} } });
    const code = await runOpenProject(ctx, {}, "/home/me/proj");
    expect(code).toBe(0);
    expect(requests[0]!.type).toBe("open_project_request");
    expect(requests[0]!.msg.path).toBe("/home/me/proj");
  });
});

describe("registerFeatureCommands", () => {
  it("does not register chat, loop or schedule", async () => {
    const { ctx } = await harness();
    const program = new Command();
    registerFeatureCommands(program, ctx, () => {});
    const names = program.commands.map((c) => c.name());
    expect(names).toEqual(expect.arrayContaining(["terminal", "provider", "worktree", "open"]));
    for (const gone of ["chat", "loop", "schedule"]) expect(names).not.toContain(gone);
  });

  it("worktree create and archive wait for the SDK's worktree timeout, not the default", async () => {
    const { ctx } = await harness();
    const spy = vi.spyOn(DaemonClient.prototype, "request");
    try {
      const program = new Command();
      registerFeatureCommands(program, ctx, () => {});
      await program.parseAsync(["worktree", "create", "x"], { from: "user" });
      await program.parseAsync(["worktree", "archive", "x"], { from: "user" });
      expect(spy).toHaveBeenCalledWith(
        FEATURE_RPC.worktreeCreate,
        expect.anything(),
        WORKTREE_TIMEOUT_MS,
      );
      expect(spy).toHaveBeenCalledWith(
        FEATURE_RPC.worktreeArchive,
        expect.anything(),
        WORKTREE_TIMEOUT_MS,
      );
    } finally {
      spy.mockRestore();
    }
  });
});
