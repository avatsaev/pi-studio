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
import { WebSocket, WebSocketServer } from "ws";

import { createClientChannel, decodeBase64 } from "@av-pi-studio/relay";
import {
  decodeFileTransferFrame,
  decodeTerminalFrame,
  encodeTerminalFrame,
  extensionPacksListResponseSchema,
  extensionPacksSetResponseSchema,
} from "@av-pi-studio/protocol";
import { CLIENT_CAPS } from "@av-pi-studio/protocol";

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
function boot(): { handle: DaemonHandle; port: number; home: string; piHome: string } {
  const home = mkdtempSync(join(tmpdir(), "pi-studio-prod-"));
  const piHome = mkdtempSync(join(tmpdir(), "pi-studio-prod-pihome-"));
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({ daemon: { piHome, extensions: { autoSync: false } } }),
    "utf8",
  );
  const port = 6800 + Math.floor(Math.random() * 200);
  const h = startDaemon({ host: "127.0.0.1", port, home, logger: silentLogger() });
  return { handle: h, port, home, piHome };
}

/** Instant, offline success for every action — no network, no real pi process. */
const succeedAlwaysSpawn: InstallSpawn = async () => ({ exitCode: 0, stderr: "" });

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
      { type: "file_move_request", path: "", destination: "" },
      { type: "checkout_status_subscribe", cwd: booted.home },
      { type: "extension_packs_list_request" },
      { type: "provider_auth_list_request" },
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

  it("composes the inline-image instruction into a persisted record's systemPrompt when the connecting client advertised inline_image_markdown (task-006) — proves the hello -> session -> handleCreate chain", async () => {
    const booted = boot();
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
    const booted = boot();
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
    const booted = boot();
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
    const booted = boot();
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
    const booted = boot();
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
    const booted = boot();
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
    const booted = boot();
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
    const booted = boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    const first = await client.rpc({ type: "resolve_default_model", provider: "mock" });
    expect(first.type).toBe("resolve_default_model_response");
    expect(first.model).toBe("mock-model");
    expect(first.modelProvider).toBe("mock");

    // Second request for the same provider/cwd hits the daemon's in-memory cache — still
    // resolves to the same value (the cache's existence is opaque from the wire, but a second
    // round trip must never fail or drift).
    const second = await client.rpc({ type: "resolve_default_model", provider: "mock" });
    expect(second.model).toBe("mock-model");
    expect(second.modelProvider).toBe("mock");

    client.close();
  }, 15000);

  it("archive_agent soft-deletes: agent is closed but its record survives on disk", async () => {
    const booted = boot();
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
    const port = 6800 + Math.floor(Math.random() * 200);
    handle = startDaemon({
      host: "127.0.0.1",
      port,
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
    const port = 6800 + Math.floor(Math.random() * 200);
    handle = startDaemon({
      host: "127.0.0.1",
      port,
      home,
      logger: silentLogger(),
      extensionsInstallSpawn: spawn,
    });

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
    const port = 6800 + Math.floor(Math.random() * 200);
    handle = startDaemon({
      host: "127.0.0.1",
      port,
      home,
      logger: silentLogger(),
      extensionsInstallSpawn: succeedAlwaysSpawn,
    });
    const client = await connect(port);

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
    const port = 6800 + Math.floor(Math.random() * 200);
    handle = startDaemon({
      host: "127.0.0.1",
      port,
      home,
      logger: silentLogger(),
      extensionsInstallSpawn: flakySpawn,
    });
    const client = await connect(port);

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
    // 4 offerable entries, one (`pi-web-access`) seeded to fail ⇒ 3 installed + 1 failure.
    expect(set2.report?.installed).toHaveLength(3);
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
    const booted = boot();
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
      const booted = boot();
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
    const booted = boot();
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
    const booted = boot();
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
    const booted = boot();
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
    const booted = boot();
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
    const booted = boot();
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
    const booted = boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    const response = await client.rpc({ type: "file_read_request", path: booted.home });
    expect(response.ok).toBe(false);
    expect(response.error).toBe("is_directory");
  }, 15000);

  it("resolves a ~-prefixed path against the real home directory", async () => {
    const booted = boot();
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

  it("issues a download token for a ~-prefixed path", async () => {
    const booted = boot();
    handle = booted.handle;
    const client = await connect(booted.port);
    const marker = `pi-studio-file-download-tilde-${Math.random().toString(36).slice(2)}.png`;
    const absolute = join(homedir(), marker);
    writeFileSync(absolute, "tilde-resolved-bytes");
    try {
      const response = await client.rpc({
        type: "file_download_token_request",
        path: `~/${marker}`,
      });
      expect(response.ok).toBe(true);
      expect(typeof response.token).toBe("string");
    } finally {
      rmSync(absolute, { force: true });
    }
  }, 15000);

  it("passes ~otheruser/x through unexpanded rather than rewriting to $HOME/otheruser/x", async () => {
    const booted = boot();
    handle = booted.handle;
    const client = await connect(booted.port);
    const response = await client.rpc({
      type: "file_download_token_request",
      path: "~otheruser/x",
    });
    expect(response.ok).toBe(false);
    expect(response.error).toBe("not_found");
  }, 15000);

  it("does not block a concurrent cheap RPC on the same connection while reading a multi-MB file", async () => {
    const booted = boot();
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
      const booted = boot();
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
    const booted = boot();
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
    const booted = boot();
    handle = booted.handle;
    const client = await connect(booted.port);

    const res = await client.rpc({ type: "provider_auth_list_request" });
    expect(res.type).toBe("provider_auth_list_response");

    client.close();
  }, 15000);

  it("a dev daemon does not register provider_auth_* — answers unknown_message_type, never wires the family", async () => {
    const port = 6900 + Math.floor(Math.random() * 200);
    const dev = startDevDaemon({ host: "127.0.0.1", port, logger: silentLogger() });
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
        daemon: {
          relay: { enabled: true, endpoint: `127.0.0.1:${relay.port}`, useTls: false },
          extensions: { autoSync: false },
        },
      }),
    );
    const port = 6800 + Math.floor(Math.random() * 200);
    handle = startDaemon({ host: "127.0.0.1", port, home, logger: silentLogger() });

    // The daemon writes its persistent keypair to disk on first boot, before it dials the relay —
    // owner-only, since the file carries the Curve25519 secret key.
    const keypairPath = join(home, "daemon-keypair.json");
    const daemonPublicKeyB64 = JSON.parse(readFileSync(keypairPath, "utf8")).publicKeyB64 as string;
    expect(statSync(keypairPath).mode & 0o777).toBe(0o600);

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

    channel.send(
      JSON.stringify({
        type: "hello",
        clientId: "relay-e2e-test",
        clientType: "cli",
        protocolVersion: 1,
      }),
    );
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
        daemon: {
          relay: { enabled: true, endpoint: `127.0.0.1:${relay.port}`, useTls: false },
          extensions: { autoSync: false },
        },
      }),
    );
    const port = 6800 + Math.floor(Math.random() * 200);
    handle = startDaemon({ host: "127.0.0.1", port, home, logger: silentLogger() });

    const daemonPublicKeyB64 = JSON.parse(readFileSync(join(home, "daemon-keypair.json"), "utf8"))
      .publicKeyB64 as string;

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

    channel.send(
      JSON.stringify({
        type: "hello",
        clientId: "relay-bin-e2e-test",
        clientType: "cli",
        protocolVersion: 1,
      }),
    );

    const createResponsePromise = waitForResponse("relay-bin-create");
    channel.send(
      JSON.stringify({
        type: "session",
        message: {
          type: "create_terminal_request",
          requestId: "relay-bin-create",
          workspaceId: "",
        },
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

  it("file download round-trips Begin/Chunk/End BINARY frames over relay with no inbound binary frame ever sent by the client first", async () => {
    // Regression: `relayReplyBinary` used to stay `null` until the daemon RECEIVED a binary
    // frame from the client (only `onBinaryMessage` populated it). Terminal I/O always sends a
    // binary `Input` frame from the client before expecting `Output` back, so it masked this gap;
    // a file download is entirely unprompted the other way — the client only ever sends TEXT
    // (`file_download_token_request`/`file_download_request`) and expects BINARY `Begin`/`Chunk`/
    // `End` frames back — so `sendBinary()` silently no-op'd on every relay-routed download.
    const relay = await startFakeRelay();
    const home = mkdtempSync(join(tmpdir(), "pi-studio-relay-download-e2e-"));
    writeFileSync(
      join(home, "config.json"),
      JSON.stringify({
        daemon: {
          relay: { enabled: true, endpoint: `127.0.0.1:${relay.port}`, useTls: false },
          extensions: { autoSync: false },
        },
      }),
    );
    const downloadPath = join(home, "download-me.txt");
    writeFileSync(downloadPath, "relay download regression fixture");

    const port = 6800 + Math.floor(Math.random() * 200);
    handle = startDaemon({ host: "127.0.0.1", port, home, logger: silentLogger() });

    const daemonPublicKeyB64 = JSON.parse(readFileSync(join(home, "daemon-keypair.json"), "utf8"))
      .publicKeyB64 as string;

    const sessionId = await waitForSessionId(relay);
    const clientSocket = await relay.connectClient(sessionId);

    const clientMessageHandlers: Array<(data: string) => void> = [];
    clientSocket.on("message", (data: Buffer, isBinary: boolean) => {
      if (!isBinary) for (const h of clientMessageHandlers) h(data.toString("utf8"));
    });

    const ready = Promise.withResolvers<void>();
    const pendingByRequestId = new Map<string, (msg: Record<string, unknown>) => void>();
    function waitForResponse(requestId: string): Promise<Record<string, unknown>> {
      return new Promise((resolve) => pendingByRequestId.set(requestId, resolve));
    }
    const receivedFrames: Uint8Array[] = [];
    const endFrame = Promise.withResolvers<void>();

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
        // No binary frame is ever sent BY the client in this test — that's the whole point.
        onBinaryMessage: (bytes) => {
          receivedFrames.push(bytes);
          const decoded = decodeFileTransferFrame(bytes);
          if (decoded.opcode === "End") endFrame.resolve();
        },
        onAuthError: (err) => ready.reject(err instanceof Error ? err : new Error(String(err))),
      },
    });
    await ready.promise;

    channel.send(
      JSON.stringify({
        type: "hello",
        clientId: "relay-download-e2e-test",
        clientType: "cli",
        protocolVersion: 1,
      }),
    );

    const tokenResponsePromise = waitForResponse("relay-dl-token");
    channel.send(
      JSON.stringify({
        type: "session",
        message: {
          type: "file_download_token_request",
          requestId: "relay-dl-token",
          path: downloadPath,
        },
      }),
    );
    const tokenResponse = await tokenResponsePromise;
    expect(tokenResponse.ok).toBe(true);

    const downloadResponsePromise = waitForResponse("relay-dl-download");
    channel.send(
      JSON.stringify({
        type: "session",
        message: {
          type: "file_download_request",
          requestId: "relay-dl-download",
          token: tokenResponse.token,
          stream: 1,
        },
      }),
    );
    const downloadResponse = await downloadResponsePromise;
    expect(downloadResponse.ok).toBe(true);

    // Proves the daemon's unprompted BINARY `Begin`/`Chunk`/`End` reply actually reached the
    // client over the relay — the exact frames `relayReplyBinary` used to drop on the floor.
    await endFrame.promise;
    const decodedFrames = receivedFrames.map((f) => decodeFileTransferFrame(f));
    expect(decodedFrames[0]).toMatchObject({ opcode: "Begin" });
    const chunk = decodedFrames.find((f) => f.opcode === "Chunk");
    expect(chunk && "data" in chunk ? Buffer.from(chunk.data).toString("utf8") : null).toBe(
      "relay download regression fixture",
    );
    expect(decodedFrames.at(-1)).toMatchObject({ opcode: "End", ok: true });

    channel.close();
    clientSocket.close();
    await handle?.close();
    handle = undefined;
    await relay.close();
  }, 15000);
});
