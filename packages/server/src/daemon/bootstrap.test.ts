import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

import { startDaemon, type DaemonHandle } from "./bootstrap.js";
import { loadAllAgents } from "../persistence/entity-stores.js";

/**
 * Integration test for the production daemon bootstrap. Boots a real daemon (temp PI_STUDIO_HOME),
 * connects a real WS client, and asserts the full RPC surface is registered (no "no handler")
 * plus disk persistence. Uses the opt-in `mock` provider so no real LLM/`pi` process is spawned.
 */

let handle: DaemonHandle | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

interface Client {
  ws: WebSocket;
  rpc: (message: Record<string, unknown>) => Promise<Record<string, unknown>>;
  close: () => void;
}

async function connect(port: number): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const pending = new Map<string, (msg: Record<string, unknown>) => void>();

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => {
      ws.send(JSON.stringify({ type: "hello", clientId: "test", clientType: "cli", protocolVersion: 1 }));
    });
    ws.on("message", (data: Buffer) => {
      const env = JSON.parse(data.toString("utf8"));
      if (env.type === "status") resolve();
      if (env.type === "session" && env.message?.requestId) {
        pending.get(env.message.requestId)?.(env.message);
      }
    });
    ws.once("error", reject);
  });

  const rpc = (message: Record<string, unknown>) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const requestId = `req-${Math.random().toString(36).slice(2)}`;
      pending.set(requestId, resolve);
      const timer = setTimeout(() => reject(new Error(`rpc timeout: ${message.type}`)), 4000);
      const done = (m: Record<string, unknown>) => {
        clearTimeout(timer);
        resolve(m);
      };
      pending.set(requestId, done);
      ws.send(JSON.stringify({ type: "session", message: { ...message, requestId } }));
    });

  return { ws, rpc, close: () => ws.close() };
}

function boot(): { handle: DaemonHandle; port: number; home: string } {
  const home = mkdtempSync(join(tmpdir(), "pi-studio-prod-"));
  const port = 6800 + Math.floor(Math.random() * 200);
  const h = startDaemon({ host: "127.0.0.1", port, home });
  return { handle: h, port, home };
}

describe("production daemon bootstrap", () => {
  it("registers the full RPC surface (no 'no handler' errors) and resolves pi as the provider", async () => {
    const booted = boot();
    handle = booted.handle;
    expect(handle.provider).toBe("pi");

    const client = await connect(booted.port);

    // Provider metadata includes the real `pi` provider.
    const providers = await client.rpc({ type: "list_providers" });
    expect(providers.type).toBe("list_providers_response");
    const ids = (providers.providers as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain("pi");

    // Every feature RPC family is registered (would be rpc_error / unknown_message_type otherwise).
    const probes: Record<string, unknown>[] = [
      { type: "list_agents_request" },
      { type: "list_workspaces_request" },
      { type: "list_projects_request" },
      { type: "schedule_list_request" },
      { type: "chat_list_request" },
      { type: "loop_list_request" },
      { type: "list_terminals_request" },
      { type: "file_explorer_request", path: booted.home },
      { type: "checkout_status_subscribe", cwd: booted.home },
    ];
    for (const probe of probes) {
      const res = await client.rpc(probe);
      expect(res.type, `handler for ${probe.type}`).not.toBe("rpc_error");
    }

    client.close();
  }, 15000);

  it("creates an agent via the opt-in mock provider and persists it to disk (reloads across boots)", async () => {
    const booted = boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    const cwd = booted.home;
    const created = await client.rpc({ type: "create_agent_request", config: { provider: "mock", cwd } });
    expect(created.type).toBe("create_agent_response");
    const agentId = (created.payload as { agentId?: string })?.agentId;
    expect(agentId).toBeTruthy();

    // Directory listing reflects it.
    const list = await client.rpc({ type: "list_agents_request" });
    const agents = list.agents as Array<{ agentId: string }>;
    expect(agents.some((a) => a.agentId === agentId)).toBe(true);

    // It persisted to disk under the temp home.
    const onDisk = await loadAllAgents(booted.home);
    expect(onDisk.some((a) => a.id === agentId)).toBe(true);

    client.close();
  }, 15000);
});
