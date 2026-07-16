import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
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

  it("delete_agent hard-deletes: removes from the directory listing and from disk", async () => {
    const booted = boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    const cwd = booted.home;
    const created = await client.rpc({ type: "create_agent_request", config: { provider: "mock", cwd } });
    const agentId = (created.payload as { agentId?: string })?.agentId as string;
    expect(agentId).toBeTruthy();

    const deleted = await client.rpc({ type: "delete_agent", agentId });
    expect(deleted.type).toBe("delete_agent_response");
    expect(deleted.ok).toBe(true);

    const list = await client.rpc({ type: "list_agents_request" });
    const agents = list.agents as Array<{ agentId: string }>;
    expect(agents.some((a) => a.agentId === agentId)).toBe(false);

    const onDisk = await loadAllAgents(booted.home);
    expect(onDisk.some((a) => a.id === agentId)).toBe(false);

    client.close();
  }, 15000);

  it("archive_agent soft-deletes: agent is closed but its record survives on disk", async () => {
    const booted = boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    const cwd = booted.home;
    const created = await client.rpc({ type: "create_agent_request", config: { provider: "mock", cwd } });
    const agentId = (created.payload as { agentId?: string })?.agentId as string;
    expect(agentId).toBeTruthy();

    const archived = await client.rpc({ type: "archive_agent", agentId });
    expect(archived.type).toBe("archive_agent_response");
    expect(archived.ok).toBe(true);

    const list = await client.rpc({ type: "list_agents_request" });
    const agents = list.agents as Array<{ agentId: string }>;
    expect(agents.some((a) => a.agentId === agentId)).toBe(false); // excluded from the active list

    const onDisk = await loadAllAgents(booted.home);
    const record = onDisk.find((a) => a.id === agentId);
    expect(record).toBeDefined(); // the record itself is still on disk
    expect(record?.archivedAt).toBeTruthy();

    client.close();
  }, 15000);

  it("file_diff_request returns a full added-lines diff for an untracked (new, unstaged) file", async () => {
    const booted = boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    // Real git repo with a committed baseline, then a brand-new untracked file — the exact
    // "created a new file" case reported as showing no diff content in the Changes tab.
    const repo = mkdtempSync(join(tmpdir(), "pi-studio-git-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
    git("init", "-q");
    git("config", "user.email", "t@t.com");
    git("config", "user.name", "t");
    writeFileSync(join(repo, "existing.txt"), "hello\n");
    git("add", "existing.txt");
    git("commit", "-q", "-m", "init");
    writeFileSync(join(repo, "new-file.txt"), "brand new content\n");

    const res = await client.rpc({
      type: "file_diff_request",
      path: "new-file.txt",
      cwd: repo,
      staged: false,
    });
    expect(res.type).toBe("file_diff_response");
    expect(res.ok).toBe(true);
    expect(res.patch).toContain("+brand new content");

    client.close();
  }, 15000);
});

describe("broadcast() session envelope", () => {
  it("wraps a bare fan-out message (terminals_update) in a session envelope on the wire", async () => {
    const booted = boot();
    handle = booted.handle;
    const ws = new WebSocket(`ws://127.0.0.1:${booted.port}`);
    const rawFrames: Record<string, unknown>[] = [];

    const opened = Promise.withResolvers<void>();
    ws.once("open", () => {
      ws.send(JSON.stringify({ type: "hello", clientId: "test-2", clientType: "cli", protocolVersion: 1 }));
    });
    ws.on("message", (data: Buffer) => {
      const env = JSON.parse(data.toString("utf8"));
      rawFrames.push(env);
      if (env.type === "status") opened.resolve();
    });
    ws.once("error", opened.reject);
    await opened.promise;

    // `create_terminal_request` broadcasts a `terminals_update` fan-out via the same `broadcast()`
    // helper `terminal-rpc.ts` uses — real production wiring, not a test double. Every real
    // `DaemonClient` only routes recognized bare top-level types (`status`/`ping`/`pong`/
    // `session`) — anything else, including an unwrapped `{ type: "terminals_update", ... }`,
    // is silently dropped by `handleTextFrame`'s `default:` case. Asserting the RAW wire frame
    // (not going through a test client that might tolerate either shape) is the point here.
    //
    // `terminal-rpc.ts`'s handler broadcasts `terminals_update` synchronously BEFORE returning
    // `create_terminal_response` (same WS connection, ordered delivery), so awaiting the
    // correlated response frame is a real completion signal that the broadcast already arrived —
    // no fixed delay needed.
    const createReqId = "term-req-1";
    const responded = Promise.withResolvers<void>();
    ws.on("message", (data: Buffer) => {
      const env = JSON.parse(data.toString("utf8"));
      const msg = env.message as Record<string, unknown> | undefined;
      if (msg?.requestId === createReqId) responded.resolve();
    });
    ws.send(
      JSON.stringify({
        type: "session",
        message: { type: "create_terminal_request", requestId: createReqId, cwd: booted.home },
      }),
    );
    await responded.promise;

    const updateFrame = rawFrames.find(
      (f) =>
        f.type === "session" &&
        (f.message as Record<string, unknown> | undefined)?.type === "terminals_update",
    );
    expect(updateFrame).toBeDefined();
    const message = updateFrame?.message as { type: string; terminals: unknown[] };
    expect(message.terminals.length).toBeGreaterThan(0);

    // No bare (unwrapped) terminals_update frame ever hit the wire.
    const bareFrame = rawFrames.find((f) => f.type === "terminals_update");
    expect(bareFrame).toBeUndefined();

    ws.close();
  }, 15000);
});
