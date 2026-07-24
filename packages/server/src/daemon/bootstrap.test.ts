import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket, WebSocketServer } from "ws";

import { createClientChannel, decodeBase64 } from "@av-pi-studio/relay";
import { decodeTerminalFrame, encodeTerminalFrame } from "@av-pi-studio/protocol";

import { startDaemon, type DaemonHandle } from "./bootstrap.js";
import { silentLogger } from "../logging/logger.js";
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
  const h = startDaemon({ host: "127.0.0.1", port, home, logger: silentLogger() });
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

  it("registers the slash-command RPC handlers (sprint-037) — unknown agent surfaces handler_error, never unknown_message_type", async () => {
    const booted = boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    const slashCommandProbes = [
      { type: "agent_session_stats_request", agentId: "missing" },
      { type: "agent_compact_request", agentId: "missing" },
      { type: "agent_new_session_request", agentId: "missing" },
      { type: "agent_switch_session_request", agentId: "missing", sessionPath: "/tmp/x.jsonl" },
      { type: "agent_fork_request", agentId: "missing", entryId: "e1" },
      { type: "agent_fork_messages_request", agentId: "missing" },
      { type: "agent_clone_request", agentId: "missing" },
      { type: "agent_set_session_name_request", agentId: "missing", name: "n" },
      { type: "agent_export_html_request", agentId: "missing" },
      { type: "agent_set_model_request", agentId: "missing", provider: "anthropic", modelId: "m1" },
      { type: "agent_cycle_model_request", agentId: "missing" },
      { type: "agent_last_assistant_text_request", agentId: "missing" },
    ];
    for (const probe of slashCommandProbes) {
      const res = await client.rpc(probe);
      // A registered handler that throws (unknown agent) yields "handler_error"; an unregistered
      // type would yield "unknown_message_type" — this distinguishes wiring from behavior.
      expect(res.type, `handler for ${probe.type}`).toBe("rpc_error");
      expect(res.code, `handler for ${probe.type}`).toBe("handler_error");
      expect(res.message as string, `handler for ${probe.type}`).toMatch(/unknown agent/);
    }

    client.close();
  }, 15000);

  it("creates an agent via the opt-in mock provider and persists it to disk (reloads across boots)", async () => {
    const booted = boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    const cwd = booted.home;
    const created = await client.rpc({
      type: "create_agent_request",
      config: { provider: "mock", cwd, model: "mock-model-x" },
    });
    expect(created.type).toBe("create_agent_response");
    const agentId = (created.payload as { agentId?: string })?.agentId;
    expect(agentId).toBeTruthy();

    // Directory listing reflects it, including the live model/provider (sprint-042).
    const list = await client.rpc({ type: "list_agents_request" });
    const rawAgents = list.agents;
    expect(Array.isArray(rawAgents)).toBe(true);
    const entries = Array.isArray(rawAgents) ? rawAgents : [];
    const entry = entries.find(
      (a): a is Record<string, unknown> =>
        typeof a === "object" && a !== null && "agentId" in a && a.agentId === agentId,
    );
    expect(entry).toBeTruthy();
    expect(entry?.provider).toBe("mock");
    expect(entry?.model).toBe("mock-model-x");

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

/**
 * Minimal fake relay for the daemon's outbound relay transport (mirrors the harness in
 * `relay-transport.test.ts`): sockets that send `{type:"relay_register",sessionId}` get paired by
 * session id; every other frame is forwarded verbatim between the pair — exactly what a real
 * relay (`@av-pi-studio/relay`'s `RelaySessionBridge`) does. Exposes `registeredSessionIds` so a
 * test can learn the session id the daemon picked without reaching into daemon internals.
 */
interface FakeRelay {
  port: number;
  registeredSessionIds: string[];
  close(): Promise<void>;
  connectClient(sessionId: string): Promise<WebSocket>;
}

async function startFakeRelay(): Promise<FakeRelay> {
  const http: Server = createServer();
  const wss = new WebSocketServer({ server: http });
  const bySession = new Map<string, WebSocket[]>();
  const registeredSessionIds: string[] = [];

  wss.on("connection", (socket: WebSocket) => {
    let sessionId: string | null = null;
    socket.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      const text = data.toString("utf8");
      if (sessionId === null) {
        const parsed = JSON.parse(text) as { type?: string; sessionId?: string };
        if (parsed.type === "relay_register" && parsed.sessionId) {
          sessionId = parsed.sessionId;
          registeredSessionIds.push(sessionId);
          const peers = bySession.get(sessionId) ?? [];
          peers.push(socket);
          bySession.set(sessionId, peers);
        }
        return;
      }
      for (const peer of bySession.get(sessionId) ?? []) {
        if (peer !== socket && peer.readyState === peer.OPEN) peer.send(text);
      }
    });
    socket.on("close", () => {
      if (sessionId === null) return;
      const peers = (bySession.get(sessionId) ?? []).filter((s) => s !== socket);
      if (peers.length > 0) bySession.set(sessionId, peers);
      else bySession.delete(sessionId);
    });
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", () => resolve()));
  const port = (http.address() as AddressInfo).port;
  return {
    port,
    registeredSessionIds,
    close: () =>
      new Promise<void>((resolve) => {
        wss.close(() => http.close(() => resolve()));
      }),
    connectClient(sessionId: string): Promise<WebSocket> {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      return new Promise((resolve, reject) => {
        socket.once("open", () => {
          socket.send(JSON.stringify({ type: "relay_register", sessionId }));
          resolve(socket);
        });
        socket.once("error", reject);
      });
    },
  };
}

async function waitForSessionId(relay: FakeRelay, timeoutMs = 3000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (relay.registeredSessionIds.length === 0) {
    if (Date.now() > deadline) throw new Error("waitForSessionId: timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return relay.registeredSessionIds[0]!;
}

describe("relay transport end-to-end (real E2EE handshake + RPC)", () => {
  it("a real relay client completes hello/server_info and an RPC round-trip through the daemon's relay dispatch", async () => {
    const relay = await startFakeRelay();
    const home = mkdtempSync(join(tmpdir(), "pi-studio-relay-e2e-"));
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        daemon: { relay: { enabled: true, endpoint: `127.0.0.1:${relay.port}`, useTls: false } },
      }),
    );
    const port = 6800 + Math.floor(Math.random() * 200);
    handle = startDaemon({ host: "127.0.0.1", port, home, logger: silentLogger() });

    // The daemon writes its persistent keypair to disk on first boot, before it dials the relay.
    const daemonPublicKeyB64 = JSON.parse(
      readFileSync(join(home, "daemon-keypair.json"), "utf8"),
    ).publicKeyB64 as string;

    const sessionId = await waitForSessionId(relay);
    const clientSocket = await relay.connectClient(sessionId);

    const clientMessageHandlers: Array<(data: string) => void> = [];
    clientSocket.on("message", (data: Buffer, isBinary: boolean) => {
      if (!isBinary) for (const h of clientMessageHandlers) h(data.toString("utf8"));
    });

    const ready = Promise.withResolvers<void>();
    const serverInfo = Promise.withResolvers<Record<string, unknown>>();
    const rpcResponse = Promise.withResolvers<Record<string, unknown>>();

    const channel = createClientChannel({
      transport: {
        send: (data) => clientSocket.send(data),
        onMessage: (h) => clientMessageHandlers.push(h),
        onClose: () => {},
        close: () => clientSocket.close(),
      },
      attachment: { sessionId },
      daemonPublicKey: decodeBase64(daemonPublicKeyB64),
      events: {
        onReady: () => ready.resolve(),
        onMessage: (plaintext) => {
          const envelope = JSON.parse(plaintext) as Record<string, unknown>;
          if (envelope.type === "status") {
            serverInfo.resolve(envelope.payload as Record<string, unknown>);
          } else if (envelope.type === "session") {
            rpcResponse.resolve(envelope.message as Record<string, unknown>);
          }
        },
        onAuthError: (err) => ready.reject(err instanceof Error ? err : new Error(String(err))),
      },
    });

    // The handshake completing PROVES real E2EE (Curve25519 ECDH + XSalsa20-Poly1305) worked
    // end-to-end through an actual relay bridge — not a mock of the crypto.
    await ready.promise;

    channel.send(JSON.stringify({ type: "hello", clientId: "relay-e2e-test", clientType: "cli", protocolVersion: 1 }));
    const info = await serverInfo.promise;
    // This is the real regression this test guards: over the relay, `hello` must reach the SAME
    // handshake path the direct WS listener runs (validate → session → `status`/`server_info`),
    // not be silently dropped by `routeTextFrame`'s `default:` case for unrecognized top-level types.
    expect(info.status).toBe("server_info");
    expect(info.serverId).toBe(handle.serverId);

    // A real RPC round-trips through the daemon's full `HandlerRegistry` surface over the same
    // encrypted channel, proving the synthetic relay `Session` persists across messages (the
    // second frame on this connection) rather than being discarded and recreated per message.
    channel.send(
      JSON.stringify({
        type: "session",
        message: { type: "list_agents_request", requestId: "relay-rpc-1" },
      }),
    );
    const rpc = await rpcResponse.promise;
    expect(rpc.requestId).toBe("relay-rpc-1");
    expect(rpc.type).not.toBe("rpc_error");

    channel.close();
    clientSocket.close();
    // Close the daemon FIRST — its outbound relay socket must drop before `relay.close()`'s
    // `http.close()` can resolve (an httpServer with a live keep-alive connection never finishes
    // closing).
    await handle?.close();
    handle = undefined;
    await relay.close();
  }, 15000);

  it("terminal create/subscribe/input/output round-trips as encrypted BINARY frames over the same relay channel", async () => {
    // Regression for the binary-over-relay gap: `sendBinary()` used to throw unconditionally on
    // the relay transport (terminal I/O is binary-framed), so terminals silently did nothing over
    // a relay connection. This proves the full path works: create a REAL terminal (real PTY, real
    // shell), subscribe to it, send a binary `Input` frame, and receive the shell's binary
    // `Output` back — all as `e2ee_bin` frames through a REAL relay bridge and REAL E2EE.
    const relay = await startFakeRelay();
    const home = mkdtempSync(join(tmpdir(), "pi-studio-relay-bin-e2e-"));
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        daemon: { relay: { enabled: true, endpoint: `127.0.0.1:${relay.port}`, useTls: false } },
      }),
    );
    const port = 6800 + Math.floor(Math.random() * 200);
    handle = startDaemon({ host: "127.0.0.1", port, home, logger: silentLogger() });

    const daemonPublicKeyB64 = JSON.parse(
      readFileSync(join(home, "daemon-keypair.json"), "utf8"),
    ).publicKeyB64 as string;

    const sessionId = await waitForSessionId(relay);
    const clientSocket = await relay.connectClient(sessionId);

    const clientMessageHandlers: Array<(data: string) => void> = [];
    clientSocket.on("message", (data: Buffer, isBinary: boolean) => {
      if (!isBinary) for (const h of clientMessageHandlers) h(data.toString("utf8"));
    });

    const ready = Promise.withResolvers<void>();
    const outputFrame = Promise.withResolvers<Uint8Array>();
    // Correlated session-message responses arrive interleaved with uncorrelated broadcasts
    // (e.g. `create_terminal_request`'s handler also fires a `terminals_update` broadcast to
    // every active session before/around the correlated response) — wait for the specific
    // `requestId` instead of the next session message.
    const pendingByRequestId = new Map<string, (msg: Record<string, unknown>) => void>();
    function waitForResponse(requestId: string): Promise<Record<string, unknown>> {
      return new Promise((resolve) => pendingByRequestId.set(requestId, resolve));
    }

    const channel = createClientChannel({
      transport: {
        send: (data) => clientSocket.send(data),
        onMessage: (h) => clientMessageHandlers.push(h),
        onClose: () => {},
        close: () => clientSocket.close(),
      },
      attachment: { sessionId },
      daemonPublicKey: decodeBase64(daemonPublicKeyB64),
      events: {
        onReady: () => ready.resolve(),
        onMessage: (plaintext) => {
          const envelope = JSON.parse(plaintext) as Record<string, unknown>;
          if (envelope.type !== "session") return;
          const msg = envelope.message as Record<string, unknown>;
          const requestId = typeof msg.requestId === "string" ? msg.requestId : undefined;
          const resolve = requestId ? pendingByRequestId.get(requestId) : undefined;
          if (resolve) {
            pendingByRequestId.delete(requestId!);
            resolve(msg);
          }
        },
        onBinaryMessage: (bytes) => {
          const decoded = decodeTerminalFrame(bytes);
          if (decoded.opcode === "Output") outputFrame.resolve(bytes);
        },
        onAuthError: (err) => ready.reject(err instanceof Error ? err : new Error(String(err))),
      },
    });
    await ready.promise;

    channel.send(JSON.stringify({ type: "hello", clientId: "relay-bin-e2e-test", clientType: "cli", protocolVersion: 1 }));

    const createResponsePromise = waitForResponse("relay-bin-create");
    channel.send(
      JSON.stringify({
        type: "session",
        message: { type: "create_terminal_request", requestId: "relay-bin-create", workspaceId: "" },
      }),
    );
    const createResponse = await createResponsePromise;
    expect(createResponse.type).not.toBe("rpc_error");
    const slot = (createResponse.terminal as { slot: number }).slot;

    const subscribeResponsePromise = waitForResponse("relay-bin-sub");
    channel.send(
      JSON.stringify({
        type: "session",
        message: { type: "subscribe_terminal_request", requestId: "relay-bin-sub", slot },
      }),
    );
    await subscribeResponsePromise;

    // Send a real binary Input frame ("echo hi\n") — this is the exact call path
    // `TerminalStreamRouter.sendInput` → `DaemonClient.sendBinary` → `Transport.sendBinary`
    // exercises from the browser, just invoked directly against the relay channel here.
    const inputBytes = encodeTerminalFrame({
      opcode: "Input",
      slot,
      data: new TextEncoder().encode("echo relay-binary-ok\n"),
    });
    channel.sendBinary(inputBytes);

    // The shell echoes the command and its output back — proves the daemon decrypted the binary
    // Input frame, wrote it to the REAL PTY, and encrypted the REAL PTY Output back as `e2ee_bin`.
    const output = await outputFrame.promise;
    const decodedOutput = decodeTerminalFrame(output);
    expect(decodedOutput.opcode).toBe("Output");

    channel.close();
    clientSocket.close();
    await handle?.close();
    handle = undefined;
    await relay.close();
  }, 15000);
});
