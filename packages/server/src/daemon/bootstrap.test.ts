import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { Writable } from "node:stream";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

import {
  createClientChannel,
  decodeBase64,
  deriveRelaySessionId,
  type Channel,
} from "@av-pi-studio/relay";
import { startRelayServer, type RelayServerHandle } from "@av-pi-studio/relay/server";
import {
  decodeFileTransferFrame,
  decodeTerminalFrame,
  encodeTerminalFrame,
  extensionPacksListResponseSchema,
  extensionPacksSetResponseSchema,
} from "@av-pi-studio/protocol";
import { CLIENT_CAPS } from "@av-pi-studio/protocol";

import { Session } from "../ws/session.js";
import { SessionSubscriptions } from "../ws/session-subscriptions.js";
import { startDaemon, type DaemonHandle } from "./bootstrap.js";
import { startDevDaemon } from "./dev-bootstrap.js";
import { createLogger, silentLogger } from "../logging/logger.js";
import { loadAllAgents } from "../persistence/entity-stores.js";
import { WorkspaceGitService } from "../projects/workspace-git-service.js";
import { FileWatchService } from "../files/file-watch-service.js";
import { INLINE_IMAGE_INSTRUCTIONS } from "../agent/inline-image-instructions.js";
import { FILE_LINK_INSTRUCTIONS } from "../agent/file-link-instructions.js";
import { MERMAID_DIAGRAM_INSTRUCTIONS } from "../agent/mermaid-diagram-instructions.js";
import { MAX_INLINE_FILE_READ_BYTES } from "../files/limits.js";
import type { InstallSpawn } from "../extensions/sync-executor.js";
import { persistedConfigSchema } from "../config/daemon-config.js";

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

async function connect(port: number, capabilities?: Record<string, boolean>): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const pending = new Map<string, (msg: Record<string, unknown>) => void>();

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => {
      ws.send(
        JSON.stringify({
          type: "hello",
          clientId: "test",
          clientType: "cli",
          protocolVersion: 1,
          ...(capabilities ? { capabilities } : {}),
        }),
      );
    });
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) return; // file-transfer and terminal frames are not RPC traffic
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

/**
 * Resolves with the port the OS actually assigned to `server`.
 *
 * Every daemon in this file binds `port: 0` and learns its port here, rather than guessing one out
 * of a fixed range. Guessing was a real flake source: vitest runs test files in parallel, and this
 * file's old `6800 + random(200)` overlapped `agent-ui-e2e.test.ts`'s `6950 + random(400)`, so two
 * concurrently-booting daemons could pick the same port. The loser hit `EADDRINUSE`, which surfaced
 * as an unhandled rejection attributed to whichever test happened to be running — with every test
 * still reported as passing. `port: 0` makes the collision impossible by construction.
 */
function listeningPort(server: Server): Promise<number> {
  if (server.listening) return Promise.resolve((server.address() as AddressInfo).port);
  return new Promise<number>((resolve, reject) => {
    server.once("listening", () => resolve((server.address() as AddressInfo).port));
    server.once("error", reject);
  });
}

/**
 * Extensions sync must never touch the real npm registry or a real pi-home while testing —
 * `daemon.extensions.autoSync: false` gates it off entirely for every `boot()`-started daemon.
 * The dedicated extensions-sync tests below override this explicitly with their own config +
 * an injected `extensionsInstallSpawn` fake, never the real one.
 *
 * `daemon.piHome` is likewise pinned to a fresh temp directory (sprint-055/task-004): without it,
 * `provider_auth_*` RPCs would fall through to `resolvePiAuthPaths`'s "undefined → Pi's own
 * default" branch and construct a real `ModelRuntime` against the developer's actual `~/.pi/agent`
 * tree — this isolates that to an empty, disposable directory instead (the real-Pi-runtime E2E is
 * task-005's deliberately separate, explicitly-real-home job).
 */
async function boot(): Promise<{
  handle: DaemonHandle;
  port: number;
  home: string;
  piHome: string;
}> {
  const home = mkdtempSync(join(tmpdir(), "pi-studio-prod-"));
  const piHome = mkdtempSync(join(tmpdir(), "pi-studio-prod-pihome-"));
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({ daemon: { piHome, extensions: { autoSync: false } } }),
    "utf8",
  );
  const h = startDaemon({ host: "127.0.0.1", port: 0, home, logger: silentLogger() });
  return { handle: h, port: await listeningPort(h.httpServer), home, piHome };
}

/** Instant, offline success for every action — no network, no real pi process. */
const succeedAlwaysSpawn: InstallSpawn = async () => ({ exitCode: 0, stderr: "" });

/** Poll `list_agents_request` until `agentId`'s entry has a truthy `title`, or throw after
 *  `timeoutMs`. A real bounded wait, not fake timers — the condition is server-side state reached
 *  only via genuine RPC round-trips over a live WebSocket, matching `waitForSessionId`'s
 *  established pattern below (relay E2E section) for the same kind of "poll a real server for
 *  async-settled state" wait. */
async function waitForAgentTitle(
  client: Client,
  agentId: string,
  timeoutMs = 2000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const list = await client.rpc({ type: "list_agents_request" });
    const entries = (list.agents as Array<Record<string, unknown>>) ?? [];
    const entry = entries.find((a) => a.agentId === agentId);
    if (entry?.title) return entry;
    if (Date.now() > deadline) throw new Error("waitForAgentTitle: timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** `create_agent_request` and `send_agent_prompt` answer once the prompt is accepted, so a turn has
 *  ended when `list_agents_request` reports the agent back at `idle` (it reads `running` from the
 *  moment the prompt is accepted). Same real bounded poll as `waitForAgentTitle`. */
async function waitForAgentIdle(client: Client, agentId: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const list = await client.rpc({ type: "list_agents_request" });
    const agents: unknown[] = Array.isArray(list.agents) ? list.agents : [];
    const idle = agents.some(
      (a) =>
        typeof a === "object" &&
        a !== null &&
        "agentId" in a &&
        a.agentId === agentId &&
        "status" in a &&
        a.status === "idle",
    );
    if (idle) return;
    if (Date.now() > deadline) throw new Error("waitForAgentIdle: timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** The stream event `kind` of a captured `agent_stream` frame ("" when the frame has no event). */
function kindOf(frame: Record<string, unknown>): string {
  const event = frame.event;
  if (event && typeof event === "object" && "kind" in event && typeof event.kind === "string") {
    return event.kind;
  }
  return "";
}

/** True for an `agent_stream` frame carrying a `tool_call` event flagged `partial: true`. */
function isPartialToolCallFrame(frame: Record<string, unknown>): boolean {
  const event = frame.event;
  return (
    kindOf(frame) === "tool_call" &&
    typeof event === "object" &&
    event !== null &&
    "partial" in event &&
    event.partial === true
  );
}

describe("production daemon bootstrap", () => {
  it("registers the full RPC surface (no 'no handler' errors) and resolves pi as the provider", async () => {
    const booted = await boot();
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
      { type: "list_terminals_request" },
      { type: "file_explorer_request", path: booted.home },
      { type: "file_move_request", path: "", destination: "" },
      { type: "checkout_status_subscribe", cwd: booted.home },
      { type: "extension_packs_list_request" },
      { type: "provider_auth_list_request" },
      { type: "skills_list_request" },
    ];
    for (const probe of probes) {
      const res = await client.rpc(probe);
      expect(res.type, `handler for ${probe.type}`).not.toBe("rpc_error");
    }

    client.close();
  }, 15000);

  it("answers the retired permission family with unknown_message_type (sprint-086)", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    const retired: Record<string, unknown>[] = [
      {
        type: "agent.permission.respond.request",
        agentId: "a1",
        permissionRequestId: "p1",
        response: "allow",
      },
      {
        type: "respond_to_permission",
        agentId: "a1",
        permissionRequestId: "p1",
        response: "allow",
      },
    ];
    for (const probe of retired) {
      const res = await client.rpc(probe);
      expect(res.type, `retired ${probe.type}`).toBe("rpc_error");
      expect(res.code, `retired ${probe.type}`).toBe("unknown_message_type");
    }

    client.close();
  }, 15000);

  it("registers the slash-command RPC handlers (sprint-037) — unknown agent surfaces handler_error, never unknown_message_type", async () => {
    const booted = await boot();
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
      { type: "agent_list_commands_request", agentId: "missing" },
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
    const booted = await boot();
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

  it.each(["#tool", "#tool empty"])(
    "streams partial tool_call frames without seq, and never persists them (%s)",
    async (prompt) => {
      const booted = await boot();
      handle = booted.handle;
      const client = await connect(booted.port);

      const streamFrames: Record<string, unknown>[] = [];
      client.ws.on("message", (data: Buffer) => {
        const env = JSON.parse(data.toString("utf8"));
        if (env.type === "session" && env.message?.type === "agent_stream") {
          streamFrames.push(env.message);
        }
      });

      const created = await client.rpc({
        type: "create_agent_request",
        config: { provider: "mock", cwd: booted.home },
      });
      const agentId = (created.payload as { agentId?: string })?.agentId as string;
      expect(agentId).toBeTruthy();
      await client.rpc({ type: "send_agent_prompt", agentId, prompt });

      const deadline = Date.now() + 4000;
      while (!streamFrames.some((f) => kindOf(f) === "turn_completed")) {
        if (Date.now() > deadline) throw new Error("timed out waiting for turn_completed");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      const partials = streamFrames.filter(isPartialToolCallFrame);
      expect(partials.length).toBeGreaterThan(0);
      for (const frame of partials) {
        expect("seq" in frame).toBe(false);
        expect(typeof frame.timestamp).toBe("string");
      }

      const fetched = await client.rpc({
        type: "fetch_agent_timeline_request",
        agentId,
        direction: "after",
      });
      const items = fetched.items as Array<{ kind: string; events?: Array<{ partial?: boolean }> }>;
      const toolItems = items.filter((i) => i.kind === "tool_call");
      expect(toolItems).toHaveLength(1);
      expect(toolItems[0]!.events).toHaveLength(2);
      expect(toolItems[0]!.events!.some((e) => e.partial === true)).toBe(false);

      client.close();
    },
    15000,
  );
  it("list_agents reports the pinned thinking level for drafts and the live (clamped) level once spawned (sprint-070)", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    // Deferred draft with a pinned level the mock provider will clamp away on spawn.
    const created = await client.rpc({
      type: "create_agent_request",
      config: { provider: "mock", cwd: booted.home, thinkingOptionId: "max" },
    });
    const agentId = (created.payload as { agentId?: string })?.agentId;
    expect(agentId).toBeTruthy();

    const entryOf = (list: Record<string, unknown>) =>
      ((list.agents as Array<Record<string, unknown>>) ?? []).find((a) => a.agentId === agentId);

    // No live session yet → the pinned config value.
    let entry = entryOf(await client.rpc({ type: "list_agents_request" }));
    expect(entry?.thinkingLevel).toBe("max");

    // First send spawns the mock session and replays the pin; the mock clamps `max` → `off`,
    // and the live value must win over the stale pin.
    await client.rpc({ type: "send_agent_prompt", agentId, prompt: "go" });
    await waitForAgentIdle(client, agentId as string);
    entry = entryOf(await client.rpc({ type: "list_agents_request" }));
    expect(entry?.thinkingLevel).toBe("off");

    client.close();
  }, 15000);

  it("auto-generates a title from the first prompt (deterministic fallback, no metadataGeneration.providers configured), broadcasts it live, and never regenerates on a later prompt", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    // Observe the raw `agent_update` broadcast carrying `title` — proves live wire delivery, not
    // just eventual `list_agents_request` state.
    const titleBroadcasts: Record<string, unknown>[] = [];
    client.ws.on("message", (data: Buffer) => {
      const env = JSON.parse(data.toString("utf8"));
      if (
        env.type === "session" &&
        env.message?.type === "agent_update" &&
        typeof env.message?.title === "string"
      ) {
        titleBroadcasts.push(env.message);
      }
    });

    const created = await client.rpc({
      type: "create_agent_request",
      config: { provider: "mock", cwd: booted.home },
      initialPrompt: "add dark mode toggle to the settings page",
    });
    const agentId = (created.payload as { agentId?: string })?.agentId;
    expect(agentId).toBeTruthy();

    const entry = await waitForAgentTitle(client, agentId as string);
    expect(entry.title).toBe("add dark mode toggle to the settings page");
    expect(titleBroadcasts.some((m) => m.agentId === agentId)).toBe(true);
    await waitForAgentIdle(client, agentId as string);

    // A second, very different prompt on the same agent must never regenerate the title
    // (write-once semantics — `record.title` already set).
    await client.rpc({
      type: "send_agent_prompt",
      agentId,
      prompt: "totally unrelated follow-up about deployment",
    });
    await waitForAgentIdle(client, agentId as string);
    const after = await waitForAgentTitle(client, agentId as string);
    expect(after.title).toBe("add dark mode toggle to the settings page");

    client.close();
  }, 15000);

  it("never overwrites an explicit create-time title with an auto-generated one", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    const created = await client.rpc({
      type: "create_agent_request",
      config: { provider: "mock", cwd: booted.home, title: "My Custom Title" },
      initialPrompt: "add dark mode toggle to the settings page",
    });
    const agentId = (created.payload as { agentId?: string })?.agentId;
    expect(agentId).toBeTruthy();

    // No event to await for "auto-title did NOT fire" — a real bounded wait is the only way to
    // assert an absence, mirroring `waitForSessionId`'s real-timer precedent above. The
    // deterministic-fallback path this would otherwise take has zero real I/O (no network, no
    // timers of its own), so this window is generous, not tight.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const list = await client.rpc({ type: "list_agents_request" });
    const entry = ((list.agents as Array<Record<string, unknown>>) ?? []).find(
      (a) => a.agentId === agentId,
    );
    expect(entry?.title).toBe("My Custom Title");

    client.close();
  }, 15000);

  it("composes the inline-image instruction into a persisted record's systemPrompt when the connecting client advertised inline_image_markdown (task-006) — proves the hello -> session -> handleCreate chain", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port, { [CLIENT_CAPS.inline_image_markdown]: true });

    const cwd = booted.home;
    const created = await client.rpc({
      type: "create_agent_request",
      config: { provider: "mock", cwd },
    });
    expect(created.type).toBe("create_agent_response");
    const agentId = (created.payload as { agentId?: string })?.agentId;
    expect(agentId).toBeTruthy();

    const onDisk = await loadAllAgents(booted.home);
    const record = onDisk.find((a) => a.id === agentId);
    expect(record?.config?.systemPrompt).toBe(INLINE_IMAGE_INSTRUCTIONS);

    client.close();
  }, 15000);

  it("leaves a persisted record's systemPrompt untouched when the connecting client did not advertise inline_image_markdown (task-006)", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port); // no capabilities advertised (the default CLI hello)

    const cwd = booted.home;
    const created = await client.rpc({
      type: "create_agent_request",
      config: { provider: "mock", cwd },
    });
    const agentId = (created.payload as { agentId?: string })?.agentId;
    expect(agentId).toBeTruthy();

    const onDisk = await loadAllAgents(booted.home);
    const record = onDisk.find((a) => a.id === agentId);
    expect(record?.config?.systemPrompt).toBeUndefined();

    client.close();
  }, 15000);
  it("composes the file-link instruction into a persisted record's systemPrompt when the connecting client advertised file_link_markdown (task-005) — proves the hello -> session -> handleCreate chain", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port, { [CLIENT_CAPS.file_link_markdown]: true });

    const cwd = booted.home;
    const created = await client.rpc({
      type: "create_agent_request",
      config: { provider: "mock", cwd },
    });
    expect(created.type).toBe("create_agent_response");
    const agentId = (created.payload as { agentId?: string })?.agentId;
    expect(agentId).toBeTruthy();

    const onDisk = await loadAllAgents(booted.home);
    const record = onDisk.find((a) => a.id === agentId);
    expect(record?.config?.systemPrompt).toBe(FILE_LINK_INSTRUCTIONS);

    client.close();
  }, 15000);

  it("composes both inline-image and file-link instructions in stable order when the connecting client advertised both capabilities (task-005)", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port, {
      [CLIENT_CAPS.inline_image_markdown]: true,
      [CLIENT_CAPS.file_link_markdown]: true,
    });

    const cwd = booted.home;
    const created = await client.rpc({
      type: "create_agent_request",
      config: { provider: "mock", cwd },
    });
    expect(created.type).toBe("create_agent_response");
    const agentId = (created.payload as { agentId?: string })?.agentId;
    expect(agentId).toBeTruthy();

    const onDisk = await loadAllAgents(booted.home);
    const record = onDisk.find((a) => a.id === agentId);
    const expected = `${INLINE_IMAGE_INSTRUCTIONS}\n\n${FILE_LINK_INSTRUCTIONS}`;
    expect(record?.config?.systemPrompt).toBe(expected);

    client.close();
  }, 15000);

  it("composes the mermaid-diagram instruction into a persisted record's systemPrompt when the connecting client advertised mermaid_diagram_markdown — proves the hello -> session -> handleCreate chain", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port, { [CLIENT_CAPS.mermaid_diagram_markdown]: true });

    const cwd = booted.home;
    const created = await client.rpc({
      type: "create_agent_request",
      config: { provider: "mock", cwd },
    });
    expect(created.type).toBe("create_agent_response");
    const agentId = (created.payload as { agentId?: string })?.agentId;
    expect(agentId).toBeTruthy();

    const onDisk = await loadAllAgents(booted.home);
    const record = onDisk.find((a) => a.id === agentId);
    expect(record?.config?.systemPrompt).toBe(MERMAID_DIAGRAM_INSTRUCTIONS);

    client.close();
  }, 15000);

  it("composes all three instructions in stable order when the connecting client advertised all three capabilities", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port, {
      [CLIENT_CAPS.inline_image_markdown]: true,
      [CLIENT_CAPS.file_link_markdown]: true,
      [CLIENT_CAPS.mermaid_diagram_markdown]: true,
    });

    const cwd = booted.home;
    const created = await client.rpc({
      type: "create_agent_request",
      config: { provider: "mock", cwd },
    });
    expect(created.type).toBe("create_agent_response");
    const agentId = (created.payload as { agentId?: string })?.agentId;
    expect(agentId).toBeTruthy();

    const onDisk = await loadAllAgents(booted.home);
    const record = onDisk.find((a) => a.id === agentId);
    const expected = `${INLINE_IMAGE_INSTRUCTIONS}\n\n${FILE_LINK_INSTRUCTIONS}\n\n${MERMAID_DIAGRAM_INSTRUCTIONS}`;
    expect(record?.config?.systemPrompt).toBe(expected);

    client.close();
  }, 15000);

  it("delete_agent hard-deletes: removes from the directory listing and from disk", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    const cwd = booted.home;
    const created = await client.rpc({
      type: "create_agent_request",
      config: { provider: "mock", cwd },
    });
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

  it("resolve_default_model resolves via the mock provider and caches across requests", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    const first = await client.rpc({ type: "resolve_default_model", provider: "mock" });
    expect(first.type).toBe("resolve_default_model_response");
    expect(first.model).toBe("mock-model");
    expect(first.modelProvider).toBe("mock");
    expect(first.thinkingLevel).toBe("off");

    // Second request for the same provider/cwd hits the daemon's in-memory cache — still
    // resolves to the same value (the cache's existence is opaque from the wire, but a second
    // round trip must never fail or drift).
    const second = await client.rpc({ type: "resolve_default_model", provider: "mock" });
    expect(second.model).toBe("mock-model");
    expect(second.modelProvider).toBe("mock");

    client.close();
  }, 15000);

  it("archive_agent soft-deletes: agent is closed but its record survives on disk", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    const cwd = booted.home;
    const created = await client.rpc({
      type: "create_agent_request",
      config: { provider: "mock", cwd },
    });
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
    const booted = await boot();
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

describe("fatal http-server error handling", () => {
  it("reports an EADDRINUSE bind failure through onFatalError instead of killing the process", async () => {
    // `startDaemon` is a library entry point — embedded by `packages/desktop` and booted
    // in-process by this very file — so it must never call `process.exit()` itself. It used to,
    // which turned a port collision in the suite into an opaque "process.exit unexpectedly called
    // with 1" unhandled rejection, misattributed to whatever test was running, with every test
    // still reported green. Terminating is the process entry point's call (`daemon/main.ts` and
    // the CLI's detached spawner both pass `onFatalError`).
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", () => resolve()));
    const occupied = (blocker.address() as AddressInfo).port;

    const home = mkdtempSync(join(tmpdir(), "pi-studio-eaddrinuse-"));
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ daemon: { piHome: join(home, "pihome"), extensions: { autoSync: false } } }),
      "utf8",
    );

    const fatal: NodeJS.ErrnoException[] = [];
    handle = startDaemon({
      host: "127.0.0.1",
      port: occupied,
      home,
      logger: silentLogger(),
      onFatalError: (err) => fatal.push(err),
    });

    // The reaching-the-handler path is async (bind error -> log -> ws teardown -> onFatalError).
    await vi.waitFor(() => expect(fatal).toHaveLength(1), { timeout: 5000 });
    expect(fatal[0]?.code).toBe("EADDRINUSE");
    // The bind failure is still recorded for the eventual exit status, just not acted on here.
    expect(process.exitCode).toBe(1);

    process.exitCode = 0; // Don't fail the whole vitest run on the way out.
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }, 15000);
});

describe("extensions sync (bootstrap fire-and-forget)", () => {
  it("logs readiness before the first extensions-sync log line; extensions never delay it", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-studio-ext-order-"));
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ daemon: { piHome: join(home, "pihome") } }), // autoSync defaults true
      "utf8",
    );
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    const logger = createLogger({ pretty: false, stdoutStream: stream, level: "debug" });
    // Instant, offline success for every action — no network, no real pi process.
    const spawn = succeedAlwaysSpawn;
    handle = startDaemon({
      host: "127.0.0.1",
      port: 0,
      home,
      logger,
      extensionsInstallSpawn: spawn,
    });

    await vi.waitFor(
      () => expect(chunks.join("")).toMatch(/installed \d+ of \d+ recommended extensions/),
      { timeout: 5000 },
    );

    const text = chunks.join("");
    const acceptIdx = text.indexOf("accepting connections");
    // Count-agnostic on purpose: this test asserts ORDERING, not the manifest's entry count.
    const syncIdx = text.search(/installed \d+ of \d+ recommended extensions/);
    expect(acceptIdx).toBeGreaterThanOrEqual(0);
    expect(syncIdx).toBeGreaterThan(acceptIdx);
  }, 15000);

  it("daemon.extensions.autoSync=false ⇒ boot performs no installs and never spawns pi", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-studio-ext-noauto-"));
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        daemon: { piHome: join(home, "pihome"), extensions: { autoSync: false } },
      }),
      "utf8",
    );
    const spawn = vi.fn<InstallSpawn>();
    handle = startDaemon({
      host: "127.0.0.1",
      port: 0,
      home,
      logger: silentLogger(),
      extensionsInstallSpawn: spawn,
    });
    const port = await listeningPort(handle.httpServer);

    // Churn the event loop through a handful of real ticks (a full WS handshake + RPC round
    // trip) so the gated fire-and-forget sync — which resolves almost immediately — has
    // definitely settled before asserting the negative.
    const client = await connect(port);
    await client.rpc({ type: "list_agents_request" });
    client.close();

    expect(spawn).not.toHaveBeenCalled();
  }, 15000);
});

describe("extension packs RPC (sprint-057)", () => {
  it("extension_packs_list_request/_set_request are registered end-to-end over a real WS connection", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-studio-ext-rpc-"));
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({ daemon: { piHome: join(home, "pihome"), extensions: { autoSync: false } } }),
      "utf8",
    );
    handle = startDaemon({
      host: "127.0.0.1",
      port: 0,
      home,
      logger: silentLogger(),
      extensionsInstallSpawn: succeedAlwaysSpawn,
    });
    const client = await connect(await listeningPort(handle.httpServer));

    const listRaw = await client.rpc({ type: "extension_packs_list_request" });
    // Validate against the real wire schema (task-001) rather than an inline cast — a response
    // that doesn't satisfy the protocol contract fails here, not silently.
    const list = extensionPacksListResponseSchema.parse(listRaw);
    expect(list.autoSync).toBe(false);
    expect(list.packs[0]?.id).toBe("core");

    const setRaw = await client.rpc({ type: "extension_packs_set_request", packs: [] });
    const set = extensionPacksSetResponseSchema.parse(setRaw);
    expect(set.ok).toBe(true);

    const raw = persistedConfigSchema.parse(
      JSON.parse(readFileSync(join(home, "config.json"), "utf8")),
    );
    expect(raw.daemon.extensions.packs).toEqual([]);

    client.close();
  }, 15000);

  it("full round trip: list -> set(with packs) -> set(without packs, one seeded failure) -> list (task-006)", async () => {
    const home = mkdtempSync(join(tmpdir(), "pi-studio-ext-roundtrip-"));
    const piHomeKey = join(home, "pihome", "agent");
    writeFileSync(
      join(home, "config.json"),
      // autoSync:false throughout — keeps this deterministic (no racing boot-sync fire-and-forget
      // against the RPC calls below) while still proving the manual path installs for real.
      JSON.stringify({ daemon: { piHome: join(home, "pihome"), extensions: { autoSync: false } } }),
      "utf8",
    );
    // `pi-web-access` fails with a 404; every other package succeeds and — mirroring what a real
    // `pi install <spec>` actually does — appends the source to settings.json, so the planner's
    // next read reports a genuine `installed` status, not `user_removed` (offered-but-absent).
    const flakySpawn: InstallSpawn = async ({ command }) => {
      const source = command.at(-1) as string;
      if (source.includes("pi-web-access")) {
        return { exitCode: 1, stderr: "npm error 404 Not Found" };
      }
      mkdirSync(piHomeKey, { recursive: true });
      const settingsPath = join(piHomeKey, "settings.json");
      const current: { packages: string[] } = existsSync(settingsPath)
        ? JSON.parse(readFileSync(settingsPath, "utf8"))
        : { packages: [] };
      current.packages.push(source);
      writeFileSync(settingsPath, JSON.stringify(current), "utf8");
      return { exitCode: 0, stderr: "" };
    };
    handle = startDaemon({
      host: "127.0.0.1",
      port: 0,
      home,
      logger: silentLogger(),
      extensionsInstallSpawn: flakySpawn,
    });
    const client = await connect(await listeningPort(handle.httpServer));

    // 1. list — fresh state, nothing attempted yet.
    const list1 = extensionPacksListResponseSchema.parse(
      await client.rpc({ type: "extension_packs_list_request" }),
    );
    expect(list1.selected).toEqual([]);
    expect(list1.lastSync).toBeUndefined();
    expect(list1.packs[0]?.packages.every((p) => p.status === "pending")).toBe(true);

    // 2. set(with packs) — `sync("selection")` IS gated by autoSync:false: persists the
    // (unchanged, empty) selection but installs nothing. Proves the documented asymmetry between
    // the two branches (task-003's spec: "with packs" is gated, "without packs" is not).
    const set1 = extensionPacksSetResponseSchema.parse(
      await client.rpc({ type: "extension_packs_set_request", packs: [] }),
    );
    expect(set1.ok).toBe(true);
    expect(set1.report?.outcome).toBe("noop");
    expect(set1.report?.installed).toEqual([]);

    // 3. set(without packs) — the ungated manual path: actually runs, surfacing the seeded
    // failure directly on the response.
    const set2 = extensionPacksSetResponseSchema.parse(
      await client.rpc({ type: "extension_packs_set_request" }),
    );
    expect(set2.ok).toBe(true);
    expect(set2.report?.outcome).toBe("partial");
    // 3 offerable entries, one (`pi-web-access`) seeded to fail ⇒ 2 installed + 1 failure.
    expect(set2.report?.installed).toHaveLength(2);
    expect(set2.report?.failures).toHaveLength(1);
    expect(set2.report?.failures[0]?.source).toBe("npm:pi-web-access");
    const failedInSet = set2.packs[0]?.packages.find((p) => p.identity === "pi-web-access");
    expect(failedInSet?.status).toBe("failed");
    expect(failedInSet?.lastError?.attempts).toBe(1);
    expect(failedInSet?.lastError?.reason).toBe("not_found");

    // 4. list — reflects the same partial state the `set` response already reported: one entry
    // failed with lastError, the rest installed, lastSync recorded.
    const list2 = extensionPacksListResponseSchema.parse(
      await client.rpc({ type: "extension_packs_list_request" }),
    );
    expect(list2.lastSync?.outcome).toBe("partial");
    const failedInList = list2.packs[0]?.packages.find((p) => p.identity === "pi-web-access");
    expect(failedInList?.status).toBe("failed");
    expect(failedInList?.lastError?.reason).toBe("not_found");
    expect(
      list2.packs[0]?.packages
        .filter((p) => p.identity !== "pi-web-access")
        .every((p) => p.status === "installed"),
    ).toBe(true);

    client.close();
  }, 15000);
});

describe("broadcast() session envelope", () => {
  it("wraps a bare fan-out message (terminals_update) in a session envelope on the wire", async () => {
    const booted = await boot();
    handle = booted.handle;
    const ws = new WebSocket(`ws://127.0.0.1:${booted.port}`);
    const rawFrames: Record<string, unknown>[] = [];

    const opened = Promise.withResolvers<void>();
    ws.once("open", () => {
      ws.send(
        JSON.stringify({
          type: "hello",
          clientId: "test-2",
          clientType: "cli",
          protocolVersion: 1,
        }),
      );
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

describe("session-close subscription cleanup", () => {
  it("closing a socket without unsubscribing releases the WorkspaceGitService listener it opened", async () => {
    // Spy on the real WorkspaceGitService.subscribe to observe whether ITS returned unsubscribe
    // is ever called — the actual regression this fixes. Wrapping (not replacing) the real
    // implementation keeps checkout_status_subscribe's real behavior intact.
    const original = WorkspaceGitService.prototype.subscribe;
    let capturedUnsub: (() => void) | null = null;
    let unsubCalled = false;
    const spy = vi
      .spyOn(WorkspaceGitService.prototype, "subscribe")
      .mockImplementation(function (this: WorkspaceGitService, cwd, listener) {
        const unsub = original.call(this, cwd, listener);
        capturedUnsub = () => {
          unsubCalled = true;
          unsub();
        };
        return capturedUnsub;
      });

    try {
      const booted = await boot();
      handle = booted.handle;
      const client = await connect(booted.port);

      const response = await client.rpc({ type: "checkout_status_subscribe", cwd: booted.home });
      expect(response.ok).toBe(true);
      expect(capturedUnsub).not.toBeNull();
      expect(unsubCalled).toBe(false);

      // Drop the connection WITHOUT sending checkout_status_unsubscribe — the leak this task
      // fixes only shows up on an ungraceful/unsubscribed disconnect.
      client.close();
      await vi.waitFor(() => expect(unsubCalled).toBe(true), { timeout: 2000 });
    } finally {
      spy.mockRestore();
    }
  }, 15000);
});

describe("file_watch RPC", () => {
  it("subscribing to a file and writing to it pushes a matching file_changed message", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port);
    const file = join(booted.home, "watched.txt");
    writeFileSync(file, "v1");

    const pushes: Record<string, unknown>[] = [];
    client.ws.on("message", (data: Buffer) => {
      const env = JSON.parse(data.toString("utf8"));
      if (env.type === "session" && env.message?.type === "file_changed") pushes.push(env.message);
    });

    const response = await client.rpc({ type: "file_watch_subscribe", path: file });
    expect(response.ok).toBe(true);
    expect(response.path).toBe(file);

    writeFileSync(file, "v2");
    await vi.waitFor(() => expect(pushes.some((p) => p.path === file)).toBe(true), {
      timeout: 2000,
    });
  }, 15000);

  it("resolves a ~-prefixed path and echoes the expanded path", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port);
    const marker = `pi-studio-file-watch-tilde-${Math.random().toString(36).slice(2)}.txt`;
    const absolute = join(homedir(), marker);
    writeFileSync(absolute, "v1");
    try {
      const response = await client.rpc({ type: "file_watch_subscribe", path: `~/${marker}` });
      expect(response.ok).toBe(true);
      expect(response.path).toBe(absolute);
    } finally {
      rmSync(absolute, { force: true });
    }
  }, 15000);

  it("replies too_many_watches over the per-session cap instead of opening unbounded watches", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    // Subscribing to the same already-existing directory repeatedly replaces in place
    // (SessionSubscriptions.add's contract) and must never count against the cap — so exceed it
    // with distinct nonexistent file targets under the same watched directory instead, each of
    // which still allocates its own SessionSubscriptions entry.
    let lastResponse: Record<string, unknown> = {};
    for (let i = 0; i < 129; i++) {
      lastResponse = await client.rpc({
        type: "file_watch_subscribe",
        path: join(booted.home, `nonexistent-${i}.txt`),
      });
    }
    expect(lastResponse.ok).toBe(false);
    expect(lastResponse.error).toBe("too_many_watches");
  }, 15000);
});

describe("file_read RPC", () => {
  it("reads a file under the inline cap and returns its content and size", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port);
    const file = join(booted.home, "small.txt");
    writeFileSync(file, "hello world");

    const response = await client.rpc({ type: "file_read_request", path: file });
    expect(response.ok).toBe(true);
    expect(response.content).toBe("hello world");
    expect(response.size).toBe(11);
  }, 15000);

  it("rejects a file over the inline cap with file_too_large, size, and maxBytes", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port);
    const file = join(booted.home, "big.txt");
    writeFileSync(file, "x".repeat(MAX_INLINE_FILE_READ_BYTES + 1));

    const response = await client.rpc({ type: "file_read_request", path: file });
    expect(response.ok).toBe(false);
    expect(response.error).toBe("file_too_large");
    expect(response.size).toBe(MAX_INLINE_FILE_READ_BYTES + 1);
    expect(response.maxBytes).toBe(MAX_INLINE_FILE_READ_BYTES);
  }, 15000);

  it("rejects a directory path with is_directory", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    const response = await client.rpc({ type: "file_read_request", path: booted.home });
    expect(response.ok).toBe(false);
    expect(response.error).toBe("is_directory");
  }, 15000);

  it("resolves a ~-prefixed path against the real home directory", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port);
    const marker = `pi-studio-file-read-tilde-${Math.random().toString(36).slice(2)}.txt`;
    const absolute = join(homedir(), marker);
    writeFileSync(absolute, "tilde-resolved");
    try {
      const response = await client.rpc({ type: "file_read_request", path: `~/${marker}` });
      expect(response.ok).toBe(true);
      expect(response.content).toBe("tilde-resolved");
    } finally {
      rmSync(absolute, { force: true });
    }
  }, 15000);

  it("downloads a ~-prefixed path", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port);
    const marker = `pi-studio-file-download-tilde-${Math.random().toString(36).slice(2)}.png`;
    const absolute = join(homedir(), marker);
    writeFileSync(absolute, "tilde-resolved-bytes");
    try {
      const response = await client.rpc({
        type: "file_download_request",
        path: `~/${marker}`,
      });
      expect(response.ok).toBe(true);
      expect(response.totalBytes).toBe("tilde-resolved-bytes".length);
    } finally {
      rmSync(absolute, { force: true });
    }
  }, 15000);

  it("passes ~otheruser/x through unexpanded rather than rewriting to $HOME/otheruser/x", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port);
    const response = await client.rpc({
      type: "file_download_request",
      path: "~otheruser/x",
    });
    expect(response.ok).toBe(false);
    expect(response.error).toBe("not_found");
  }, 15000);

  it("does not block a concurrent cheap RPC on the same connection while reading a multi-MB file", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port);
    const file = join(booted.home, "large.txt");
    // Just under the inline cap — large enough that a synchronous readFileSync's decode would be
    // observable, without inflating the test's own runtime.
    writeFileSync(file, "y".repeat(4 * 1024 * 1024));

    const largeReadStarted = performance.now();
    const largeRead = client.rpc({ type: "file_read_request", path: file });
    const cheapRead = client
      .rpc({ type: "file_read_request", path: join(booted.home, "..") })
      .catch(() => ({}));
    // A cheap request issued right after the large one must not be forced to wait for the large
    // read to finish — it should settle (successfully or not; only its *timing* is asserted here)
    // within a small bound rather than being serialized behind the large read on a blocked event
    // loop. Race a short timer against it as the bound.
    const raceResult = await Promise.race([
      cheapRead.then(() => "cheap"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 300)),
    ]);
    expect(raceResult).toBe("cheap");
    await largeRead;
    void largeReadStarted;
  }, 15000);
});

describe("file_watch session-close cleanup", () => {
  it("closing a socket without unsubscribing releases the FileWatchService subscription it opened", async () => {
    // Same shape as the checkout_status regression above, but for file_watch — spies on the real
    // FileWatchService.subscribe to observe whether ITS returned unsubscribe is ever called.
    const original = FileWatchService.prototype.subscribe;
    let capturedUnsub: (() => void) | null = null;
    let unsubCalled = false;
    const spy = vi
      .spyOn(FileWatchService.prototype, "subscribe")
      .mockImplementation(function (this: FileWatchService, path, listener) {
        const unsub = original.call(this, path, listener);
        capturedUnsub = () => {
          unsubCalled = true;
          unsub();
        };
        return capturedUnsub;
      });

    try {
      const booted = await boot();
      handle = booted.handle;
      const client = await connect(booted.port);
      const file = join(booted.home, "watched.txt");
      writeFileSync(file, "v1");

      const response = await client.rpc({ type: "file_watch_subscribe", path: file });
      expect(response.ok).toBe(true);
      expect(capturedUnsub).not.toBeNull();
      expect(unsubCalled).toBe(false);

      // Drop the connection WITHOUT sending file_watch_unsubscribe — the leak this pairs with
      // task-005 to fix only shows up on an ungraceful/unsubscribed disconnect.
      client.close();
      await vi.waitFor(() => expect(unsubCalled).toBe(true), { timeout: 2000 });
    } finally {
      spy.mockRestore();
    }
  }, 15000);
});

describe("provider_auth (sprint-055/task-004)", () => {
  it("server_info.features.providerAuth is true on a production daemon (direct handshake path)", async () => {
    const booted = await boot();
    handle = booted.handle;

    const status = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${booted.port}`);
      ws.once("open", () => {
        ws.send(
          JSON.stringify({
            type: "hello",
            clientId: "feature-probe",
            clientType: "cli",
            protocolVersion: 1,
          }),
        );
      });
      ws.on("message", (data: Buffer) => {
        const env = JSON.parse(data.toString("utf8"));
        if (env.type === "status") {
          ws.close();
          resolve(env);
        }
      });
      ws.once("error", reject);
    });

    const payload = status.payload as { features?: Record<string, boolean> };
    expect(payload.features?.providerAuth).toBe(true);
  }, 15000);

  it("answers provider_auth_list_request on a production daemon", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    const res = await client.rpc({ type: "provider_auth_list_request" });
    expect(res.type).toBe("provider_auth_list_response");

    client.close();
  }, 15000);

  it("a dev daemon does not register provider_auth_* — answers unknown_message_type, never wires the family", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    const port = await listeningPort(dev.httpServer);
    try {
      const client = await connect(port);
      const res = await client.rpc({ type: "provider_auth_list_request" });
      expect(res.type).toBe("rpc_error");
      expect(res.code).toBe("unknown_message_type");
      client.close();
    } finally {
      await dev.close();
    }
  }, 15000);
});

describe("skills (sprint-075/task-004)", () => {
  it("answers skills_list_request on a production daemon", async () => {
    const booted = await boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    const res = await client.rpc({ type: "skills_list_request" });
    expect(res.type).toBe("skills_list_response");
    expect(res.ok).toBe(true);

    client.close();
  }, 15000);

  it("a dev daemon does not register skills_* — answers unknown_message_type, never wires the family", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    const port = await listeningPort(dev.httpServer);
    try {
      const client = await connect(port);
      const listRes = await client.rpc({ type: "skills_list_request" });
      expect(listRes.type).toBe("rpc_error");
      expect(listRes.code).toBe("unknown_message_type");

      const setRes = await client.rpc({
        type: "skills_set_enabled_request",
        path: "/does/not/matter",
        enabled: false,
      });
      expect(setRes.type).toBe("rpc_error");
      expect(setRes.code).toBe("unknown_message_type");
      client.close();
    } finally {
      await dev.close();
    }
  }, 15000);
});

describe("dev daemon auto-titling", () => {
  it("the dev daemon auto-generates a title too, via its deterministic-only titler (no ModelRuntime)", async () => {
    const dev = startDevDaemon({ host: "127.0.0.1", port: 0, logger: silentLogger() });
    const port = await listeningPort(dev.httpServer);
    try {
      const client = await connect(port);
      const created = await client.rpc({
        type: "create_agent_request",
        config: { provider: "mock", cwd: "/tmp" },
        initialPrompt: "add dark mode toggle to the settings page",
      });
      const agentId = (created.payload as { agentId?: string })?.agentId;
      expect(agentId).toBeTruthy();

      const entry = await waitForAgentTitle(client, agentId as string);
      expect(entry.title).toBe("add dark mode toggle to the settings page");
      await waitForAgentIdle(client, agentId as string);

      client.close();
    } finally {
      await dev.close();
    }
  }, 15000);
});

/**
 * Relay end-to-end: the production `startDaemon` against the real relay server
 * (`@av-pi-studio/relay/server`), driven by raw clients that speak relay protocol 2 with
 * `createClientChannel`. Each client connection gets its own daemon session.
 */
interface RelayRig {
  relay: RelayServerHandle;
  home: string;
  sessionId: string;
  daemonPublicKey: Uint8Array;
}

interface RelayClient {
  ws: WebSocket;
  channel: Channel;
  closed: Promise<{ code: number; reason: string }>;
  /** Binary records received from the daemon, in order. */
  binaries: Uint8Array[];
  /** Resolves with the `server_info` payload once `hello` is answered. */
  hello(fields?: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Send a `session` request and resolve with the daemon's reply for its `requestId`. */
  rpc(requestId: string, message: Record<string, unknown>): Promise<Record<string, unknown>>;
}

let relayServer: RelayServerHandle | undefined;
const relaySockets: WebSocket[] = [];

describe("relay transport end-to-end (real relay server, protocol 2, real E2EE + RPC)", () => {
  afterEach(async () => {
    // The daemon first: its sockets must drop before the relay's `close()` has to wait for them.
    await handle?.close();
    handle = undefined;
    for (const ws of relaySockets.splice(0)) ws.terminate();
    await relayServer?.close();
    relayServer = undefined;
  });

  async function bootRelayDaemon(prefix: string): Promise<RelayRig> {
    const relay = await startRelayServer({ host: "127.0.0.1", port: 0 });
    relayServer = relay;
    const home = mkdtempSync(join(tmpdir(), `pi-studio-${prefix}-`));
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        daemon: {
          relay: { enabled: true, endpoint: `127.0.0.1:${relay.port}`, useTls: false },
          extensions: { autoSync: false },
        },
      }),
    );
    handle = startDaemon({ host: "127.0.0.1", port: 0, home, logger: silentLogger() });
    // Barrier only: these tests drive the daemon over the relay, not its own WS port, but must
    // still let it finish binding before proceeding.
    await listeningPort(handle.httpServer);

    // The daemon writes its persistent keypair to disk on first boot, before it dials the relay —
    // owner-only, since the file carries the Curve25519 secret key.
    const keypairPath = join(home, "daemon-keypair.json");
    expect(statSync(keypairPath).mode & 0o777).toBe(0o600);
    const daemonPublicKey = decodeBase64(
      JSON.parse(readFileSync(keypairPath, "utf8")).publicKeyB64 as string,
    );
    // The control socket is registered: the relay can now dial the daemon for a client.
    await vi.waitFor(() => expect(relay.counts().controls).toBe(1), { timeout: 3000 });
    return { relay, home, sessionId: deriveRelaySessionId(daemonPublicKey), daemonPublicKey };
  }

  /** Connect a client through the relay and complete the channel key exchange. */
  async function openRelayClient(rig: RelayRig): Promise<RelayClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${rig.relay.port}`);
    relaySockets.push(ws);
    const closed = Promise.withResolvers<{ code: number; reason: string }>();
    ws.on("close", (code, reason: Buffer) =>
      closed.resolve({ code, reason: reason.toString("utf8") }),
    );
    const paired = Promise.withResolvers<void>();
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      // Before the channel starts, the only text frame is the relay's `relay_paired`.
      if (!isBinary && data.toString("utf8").includes("relay_paired")) paired.resolve();
    });
    const opened = Promise.withResolvers<void>();
    ws.once("open", () => opened.resolve());
    ws.once("error", (err) => opened.reject(err));
    await opened.promise;
    ws.send(JSON.stringify({ type: "relay_client_connect", v: 2, sessionId: rig.sessionId }));
    await paired.promise;

    const ready = Promise.withResolvers<void>();
    const info = Promise.withResolvers<Record<string, unknown>>();
    const binaries: Uint8Array[] = [];
    // Correlated session-message responses arrive interleaved with uncorrelated broadcasts (e.g.
    // `create_terminal_request` also fires a `terminals_update`), so wait on the `requestId`.
    const pendingByRequestId = new Map<string, (msg: Record<string, unknown>) => void>();
    const channel = createClientChannel({
      daemonPublicKey: rig.daemonPublicKey,
      transport: {
        send: (bytes) => ws.send(bytes),
        onFrame: (h) =>
          ws.on("message", (data: Buffer, isBinary: boolean) =>
            h(isBinary ? new Uint8Array(data) : data.toString("utf8")),
          ),
        onClose: (h) => ws.on("close", (code, reason: Buffer) => h(code, reason.toString("utf8"))),
        close: (code, reason) => ws.close(code, reason),
      },
      events: {
        onReady: () => ready.resolve(),
        onText: (text) => {
          const envelope = JSON.parse(text) as Record<string, unknown>;
          if (envelope.type === "status") {
            info.resolve(envelope.payload as Record<string, unknown>);
            return;
          }
          if (envelope.type !== "session") return;
          const msg = envelope.message as Record<string, unknown>;
          const requestId = typeof msg.requestId === "string" ? msg.requestId : undefined;
          const resolve = requestId ? pendingByRequestId.get(requestId) : undefined;
          if (requestId && resolve) {
            pendingByRequestId.delete(requestId);
            resolve(msg);
          }
        },
        onBinary: (bytes) => binaries.push(bytes),
        onError: (err) => ready.reject(err),
      },
    });
    // The key exchange completing PROVES real E2EE (Curve25519 + XSalsa20-Poly1305) worked
    // end-to-end through an actual relay — not a mock of the crypto.
    await ready.promise;

    return {
      ws,
      channel,
      closed: closed.promise,
      binaries,
      hello: (fields = {}) => {
        channel.send(
          JSON.stringify({
            type: "hello",
            clientId: "relay-e2e-test",
            clientType: "cli",
            protocolVersion: 1,
            ...fields,
          }),
        );
        return info.promise;
      },
      rpc: (requestId, message) => {
        const reply = new Promise<Record<string, unknown>>((resolve) =>
          pendingByRequestId.set(requestId, resolve),
        );
        channel.send(JSON.stringify({ type: "session", message: { ...message, requestId } }));
        return reply;
      },
    };
  }

  it("a real relay client completes hello/server_info and an RPC round-trip through the daemon's relay dispatch", async () => {
    const rig = await bootRelayDaemon("relay-e2e");
    const client = await openRelayClient(rig);

    const info = await client.hello();
    // Over the relay, `hello` must reach the SAME handshake path the direct WS listener runs
    // (validate → session → `status`/`server_info`).
    expect(info.status).toBe("server_info");
    expect(info.serverId).toBe(handle!.serverId);
    expect((info.features as Record<string, boolean>).daemonObservability).toBe(true);

    // A real RPC round-trips through the daemon's full `HandlerRegistry` surface over the same
    // channel, proving the relay session persists across messages.
    const rpc = await client.rpc("relay-rpc-1", { type: "list_agents_request" });
    expect(rpc.requestId).toBe("relay-rpc-1");
    expect(rpc.type).not.toBe("rpc_error");

    client.channel.close();
  }, 15000);

  it("two clients complete hello at once, each gets its own RPC answers, and daemon_status lists two relay sessions", async () => {
    const rig = await bootRelayDaemon("relay-two");
    const [a, b] = await Promise.all([openRelayClient(rig), openRelayClient(rig)]);

    const [infoA, infoB] = await Promise.all([
      a.hello({ clientId: "relay-two-a" }),
      b.hello({ clientId: "relay-two-b" }),
    ]);
    expect(infoA.status).toBe("server_info");
    expect(infoB.status).toBe("server_info");

    // Both RPCs are in flight together; each answer carries its own requestId and lands on its own
    // connection (the other client's pending map would never match it).
    const [rpcA, rpcB] = await Promise.all([
      a.rpc("two-a", { type: "list_agents_request" }),
      b.rpc("two-b", { type: "list_agents_request" }),
    ]);
    expect(rpcA.requestId).toBe("two-a");
    expect(rpcB.requestId).toBe("two-b");
    expect(rpcA.type).not.toBe("rpc_error");
    expect(rpcB.type).not.toBe("rpc_error");

    const status = await a.rpc("two-status", { type: "daemon_status_request" });
    const clients = (status.payload as { clients: Array<{ clientId: string; transport: string }> })
      .clients;
    expect(
      clients
        .filter((c) => c.transport === "relay")
        .map((c) => c.clientId)
        .toSorted(),
    ).toEqual(["relay-two-a", "relay-two-b"]);
    expect(rig.relay.counts().pairs).toBe(2);

    a.channel.close();
    b.channel.close();
  }, 15000);

  it("closing one client disposes only its session; the other keeps working", async () => {
    const rig = await bootRelayDaemon("relay-close-one");
    const a = await openRelayClient(rig);
    const b = await openRelayClient(rig);
    await Promise.all([
      a.hello({ clientId: "relay-close-a" }),
      b.hello({ clientId: "relay-close-b" }),
    ]);
    const relayClientIds = async (): Promise<string[]> => {
      const status = await b.rpc(`status-${Math.random()}`, { type: "daemon_status_request" });
      return (status.payload as { clients: Array<{ clientId: string; transport: string }> }).clients
        .filter((c) => c.transport === "relay")
        .map((c) => c.clientId)
        .toSorted();
    };
    expect(await relayClientIds()).toEqual(["relay-close-a", "relay-close-b"]);

    a.channel.close();
    await a.closed;
    await vi.waitFor(async () => expect(await relayClientIds()).toEqual(["relay-close-b"]), {
      timeout: 3000,
    });
    // The surviving client's connection, session and RPC surface are untouched.
    const rpc = await b.rpc("close-one-rpc", { type: "list_agents_request" });
    expect(rpc.type).not.toBe("rpc_error");
    await vi.waitFor(() => expect(rig.relay.counts().pairs).toBe(1), { timeout: 3000 });

    b.channel.close();
  }, 15000);

  it("an invalid first application message closes that client with 1008", async () => {
    const rig = await bootRelayDaemon("relay-bad-hello");
    const bad = await openRelayClient(rig);
    const good = await openRelayClient(rig);

    // Not a `hello`: same rule as a direct connection (`ws-server.ts`), and the relay forwards the
    // daemon's 1008 to the client unchanged.
    bad.channel.send(JSON.stringify({ type: "session", message: { type: "list_agents_request" } }));
    expect((await bad.closed).code).toBe(1008);

    // The other client is unaffected.
    await good.hello({ clientId: "relay-bad-hello-good" });
    const rpc = await good.rpc("bad-hello-rpc", { type: "list_agents_request" });
    expect(rpc.type).not.toBe("rpc_error");

    good.channel.close();
  }, 15000);

  it("relay Session carries relay metadata, and closing a relay client disposes its own session's subscriptions (sprint-084/task-003)", async () => {
    const disposed: Array<{
      transport: string;
      appVersion: string | undefined;
      remoteAddress: string | undefined;
      agentStreams: string;
    }> = [];
    const spy = vi
      .spyOn(SessionSubscriptions.prototype, "disposeSession")
      .mockImplementation((session) => {
        disposed.push({
          transport: session.transport,
          appVersion: session.appVersion,
          remoteAddress: session.remoteAddress,
          agentStreams: session.agentStreams,
        });
      });
    try {
      const rig = await bootRelayDaemon("relay-meta-e2e");
      const first = await openRelayClient(rig);
      await first.hello({
        clientId: "relay-meta-first/1",
        appVersion: "first/1",
        agentStreams: "none",
      });
      expect(disposed).toHaveLength(0);
      // A second client on the same session id gets its OWN session; nothing is replaced.
      const second = await openRelayClient(rig);
      await second.hello({
        clientId: "relay-meta-second/2",
        appVersion: "second/2",
        agentStreams: "bogus",
      });
      expect(disposed).toHaveLength(0);

      // Closing the first client runs the same per-session disposal a direct close runs, for that
      // session only.
      first.channel.close();
      await vi.waitFor(() => expect(disposed.length).toBeGreaterThanOrEqual(1), { timeout: 3000 });
      expect(disposed).toEqual([
        {
          transport: "relay",
          appVersion: "first/1",
          remoteAddress: undefined,
          // The relay `hello` path carries the mode too (a bad value reads as "all").
          agentStreams: "none",
        },
      ]);

      second.channel.close();
      await vi.waitFor(() => expect(disposed).toHaveLength(2), { timeout: 3000 });
      expect(disposed[1]).toMatchObject({ transport: "relay", appVersion: "second/2" });
    } finally {
      spy.mockRestore();
    }
  }, 20000);

  it("terminal create/subscribe/input/output round-trips as encrypted BINARY frames over the same relay channel", async () => {
    // Regression for the binary-over-relay gap: terminal I/O is binary-framed, so it must travel as
    // binary channel records. Creates a REAL terminal (real PTY, real shell), subscribes, sends a
    // binary `Input` frame, and receives the shell's binary `Output` back through the real relay.
    const rig = await bootRelayDaemon("relay-bin-e2e");
    const client = await openRelayClient(rig);
    await client.hello({ clientId: "relay-bin-e2e-test" });

    const created = await client.rpc("relay-bin-create", {
      type: "create_terminal_request",
      workspaceId: "",
    });
    expect(created.type).not.toBe("rpc_error");
    const slot = (created.terminal as { slot: number }).slot;
    await client.rpc("relay-bin-sub", { type: "subscribe_terminal_request", slot });

    client.channel.sendBinary(
      encodeTerminalFrame({
        opcode: "Input",
        slot,
        data: new TextEncoder().encode("echo relay-binary-ok\n"),
      }),
    );

    // The shell echoes the command and its output back — proves the daemon decrypted the binary
    // `Input` record, wrote it to the REAL PTY, and sent the REAL PTY `Output` back as binary.
    await vi.waitFor(
      () =>
        expect(client.binaries.some((b) => decodeTerminalFrame(b).opcode === "Output")).toBe(true),
      { timeout: 5000 },
    );

    client.channel.close();
  }, 15000);

  it("file download round-trips Begin/Chunk/End BINARY frames over relay and paces on a numeric bufferedAmount", async () => {
    // The client only ever sends TEXT (`file_download_request`) and expects BINARY
    // `Begin`/`Chunk`/`End` frames back, unprompted — and the session reports the data socket's
    // queued bytes, so download pacing is no longer skipped on the relay.
    const reported: unknown[] = [];
    const original = Object.getOwnPropertyDescriptor(Session.prototype, "bufferedAmount")!.get!;
    const spy = vi
      .spyOn(Session.prototype, "bufferedAmount", "get")
      .mockImplementation(function (this: Session) {
        const queued = original.call(this) as unknown;
        if (this.transport === "relay") reported.push(queued);
        return queued as number | undefined;
      });
    try {
      const rig = await bootRelayDaemon("relay-download-e2e");
      const downloadPath = join(rig.home, "download-me.txt");
      writeFileSync(downloadPath, "relay download regression fixture");

      const client = await openRelayClient(rig);
      await client.hello({ clientId: "relay-download-e2e-test" });

      const download = await client.rpc("relay-dl-download", {
        type: "file_download_request",
        path: downloadPath,
        stream: 1,
      });
      expect(download).toMatchObject({
        ok: true,
        totalBytes: "relay download regression fixture".length,
      });

      await vi.waitFor(
        () =>
          expect(client.binaries.map((f) => decodeFileTransferFrame(f).opcode)).toContain("End"),
        { timeout: 5000 },
      );
      const decodedFrames = client.binaries.map((f) => decodeFileTransferFrame(f));
      expect(decodedFrames[0]).toMatchObject({ opcode: "Begin" });
      const chunk = decodedFrames.find((f) => f.opcode === "Chunk");
      expect(chunk && "data" in chunk ? Buffer.from(chunk.data).toString("utf8") : null).toBe(
        "relay download regression fixture",
      );
      expect(decodedFrames.at(-1)).toMatchObject({ opcode: "End", ok: true });

      // `bufferedAmount` was read for the relay session and was a number every time (never the
      // `undefined` that means "do not pace").
      expect(reported.length).toBeGreaterThan(0);
      expect(reported.every((queued) => typeof queued === "number")).toBe(true);

      client.channel.close();
    } finally {
      spy.mockRestore();
    }
  }, 15000);
});
