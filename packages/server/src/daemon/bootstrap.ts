/**
 * Production daemon bootstrap — the REAL daemon: loads `PI_STUDIO_HOME/config.json`, resolves the
 * real provider (`pi` spawns `pi --mode rpc`), persists agents to disk, and registers the full RPC
 * surface (agents/sessions/timeline/permissions, projects/workspaces/open-project, git status/diff/
 * ops + GitHub PR + worktrees, file explorer + transfer, service proxy, terminals + binary frames,
 * schedules/chat/loops, providers). Mirrors `dev-bootstrap.ts` but is production-grade.
 *
 * See: architecture/daemon-bootstrap.md, config.md, persistence.md, auth-security.md.
 */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Server as HttpServer } from "node:http";
import nacl from "tweetnacl";

import { createHttpServer } from "../http/http-server.js";
import { createWebSocketServer } from "../ws/ws-server.js";
import { HandlerRegistry, routeTextFrame, routeBinaryFrame } from "../ws/router.js";
import { Session } from "../ws/session.js";
import { createInMemoryCapabilityStore } from "../ws/capability-store.js";
import { SessionSubscriptions } from "../ws/session-subscriptions.js";
import { createHostChecker } from "../http/host-allowlist.js";
import { createPasswordAuth, resolvePasswordHash } from "../auth/password-auth.js";
import { expandHome } from "../files/resolve-path.js";

import { loadConfig, type PersistedConfig } from "../config/daemon-config.js";
import { createDaemonLogger, type Logger } from "../logging/logger.js";
import { AgentManager } from "../agent/agent-manager.js";
import { AgentService, getTimeline } from "../agent/agent-service.js";
import { SessionOperationsService } from "../agent/session-operations.js";
import { SlashCommandOperationsService } from "../agent/slash-command-operations.js";
import { registerTimelineHandler } from "../agent/timeline-rpc.js";
import { PermissionService } from "../agent/permissions.js";
import { ProviderRegistry, resolveProviderClient } from "../agent/provider-registry.js";
import type { AgentClient } from "../agent/provider-contract.js";
import { saveAgent, loadAllAgents } from "../persistence/entity-stores.js";

import { FileExplorerService } from "../files/file-explorer.js";
import { FileTransferService } from "../files/file-transfer.js";
import { FileWatchService } from "../files/file-watch-service.js";
import { registerFileWatchHandlers } from "../files/file-watch-rpc.js";
import { MAX_INLINE_FILE_READ_BYTES } from "../files/limits.js";

import { OpenProjectService } from "../projects/open-project.js";
import { WorkspaceRegistryService } from "../projects/workspace-registry.js";
import { GitOperationsService } from "../projects/git-operations.js";
import { registerGitCheckoutHandlers } from "../projects/git-checkout-rpc.js";
import { WorkspaceGitService } from "../projects/workspace-git-service.js";
import { CheckoutDiffManager } from "../projects/checkout-diff-manager.js";
import { GitHubService } from "../projects/github-service.js";
import { WorktreeService } from "../projects/worktree-service.js";

import { TerminalManager } from "../terminal/terminal-manager.js";
import { registerTerminalHandlers, makeTerminalBinaryHandler } from "../terminal/terminal-rpc.js";

import { ServiceProxy, resolveServiceProxyConfig } from "../proxy/service-proxy.js";

import { ScheduleService, type ScheduleExecutor } from "../orchestration/schedule-service.js";
import { ChatService } from "../orchestration/chat-service.js";
import {
  LoopService,
  type LoopExecutor,
  type WorkerOutcome,
} from "../orchestration/loop-service.js";
import { registerOrchestrationHandlers } from "./orchestration-rpc.js";
import { ExtensionsService } from "../extensions/extensions-service.js";
import { registerExtensionsHandlers } from "../extensions/extensions-rpc.js";
import type { InstallSpawn } from "../extensions/sync-executor.js";

import {
  SERVER_FEATURES,
  helloSchema,
  serverInfoPayloadSchema,
  statusSchema,
} from "@av-pi-studio/protocol";
import { connectRelay, type RelayTransportHandle } from "./relay-transport.js";

export interface DaemonOptions {
  host: string;
  port: number;
  /** Overrides `PI_STUDIO_HOME` (defaults to `~/.pi-studio`). */
  home?: string;
  /** Overrides the config path (defaults to `<home>/config.json`). */
  configPath?: string;
  serverId?: string;
  /**
   * Operational logger. Defaults to `createDaemonLogger(home)`: stdout always (pretty TTY /
   * NDJSON otherwise) plus a rotating NDJSON file under `<home>/logs/`, level from
   * `PI_STUDIO_LOG_LEVEL` (default `info`). Tests inject `silentLogger()`.
   */
  logger?: Logger;
  /** Test-only injection for the preinstalled-extensions sync executor's process seam; production
   *  always spawns the bundled `pi` (`defaultInstallSpawn`). */
  extensionsInstallSpawn?: InstallSpawn;
}

export interface DaemonHandle {
  httpServer: HttpServer;
  serverId: string;
  home: string;
  provider: string;
  logger: Logger;
  close(): Promise<void>;
}

function resolveHome(opts: DaemonOptions): string {
  return opts.home ?? process.env.PI_STUDIO_HOME ?? join(homedir(), ".pi-studio");
}

/** Read a stable server id from `<home>/server-id`, generating + persisting one if absent. */
function resolveServerId(home: string, override?: string): string {
  if (override) return override;
  if (process.env.PI_STUDIO_SERVER_ID) return process.env.PI_STUDIO_SERVER_ID;
  const path = join(home, "server-id");
  if (existsSync(path)) {
    const value = readFileSync(path, "utf8").trim();
    if (value) return value;
  }
  const id = randomUUID();
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(path, id, "utf8");
  } catch {
    /* best-effort persistence */
  }
  return id;
}

/**
 * Read (or generate + persist) the daemon's stable Curve25519 keypair for pairing
 * (architecture/relay-e2ee.md § Pairing). Stored as base64 at `<home>/daemon-keypair.json`;
 * the CLI's `readDaemonPublicKey()` reads the same file/shape to build the pairing QR URL.
 */
function resolveDaemonKeypair(home: string): { publicKeyB64: string; secretKeyB64: string } {
  const path = join(home, "daemon-keypair.json");
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as {
        publicKeyB64?: string;
        secretKeyB64?: string;
      };
      if (parsed.publicKeyB64 && parsed.secretKeyB64) {
        // Contains the secret key — re-tighten files written before mode 0600 was enforced.
        try {
          chmodSync(path, 0o600);
        } catch {
          /* best-effort */
        }
        return { publicKeyB64: parsed.publicKeyB64, secretKeyB64: parsed.secretKeyB64 };
      }
    } catch {
      /* fall through to regenerate */
    }
  }
  const { publicKey, secretKey } = nacl.box.keyPair();
  const keypair = {
    publicKeyB64: Buffer.from(publicKey).toString("base64"),
    secretKeyB64: Buffer.from(secretKey).toString("base64"),
  };
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(path, JSON.stringify(keypair), { encoding: "utf8", mode: 0o600 });
  } catch {
    /* best-effort persistence */
  }
  return keypair;
}

/** Best-effort PID lock file so a stale daemon is discoverable. */
function writePidLock(home: string): void {
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "pi-studio.pid"), String(process.pid), "utf8");
  } catch {
    /* best-effort */
  }
}

/**
 * Every WS client only routes bare top-level frames it recognizes (`status`/`ping`/`pong`/
 * `session`) — `DaemonClient.handleTextFrame`'s `default:` case silently drops anything else,
 * including unwrapped fan-out messages like `{ type: "terminals_update", ... }`. Call sites across
 * the daemon send plain "session update" objects (`agent_update`, `workspace_update`,
 * `terminals_update`, …) expecting them to reach `onSessionMessage` subscribers, so `broadcast`
 * wraps every message in the `session` envelope through this helper. A few call sites already
 * wrap manually (`{ type: "session", message: event }`) — passed through as-is, never
 * double-wrapped.
 */
export function wrapSessionEnvelope(
  message: unknown,
): { type: "session"; message: unknown } | unknown {
  const isRecord = typeof message === "object" && message !== null;
  if (isRecord && (message as Record<string, unknown>).type === "session") return message;
  return { type: "session", message };
}

/**
 * Start the real production daemon. Returns a handle exposing the HTTP server, serverId, and a
 * `close()` for graceful shutdown.
 */
export function startDaemon(opts: DaemonOptions): DaemonHandle {
  const home = resolveHome(opts);
  mkdirSync(home, { recursive: true });
  const logger = opts.logger ?? createDaemonLogger(home);
  const configPath = opts.configPath ?? join(home, "config.json");
  const config: PersistedConfig = loadConfig(configPath, process.env);
  const serverId = resolveServerId(home, opts.serverId);
  const daemonKeypairB64 = resolveDaemonKeypair(home);
  writePidLock(home);
  logger.info({ home, configPath, serverId }, "daemon starting");

  // ── Preinstalled-extensions sync (constructed here; kicked off after the WS server is
  // accepting connections — see the fire-and-forget block right before `return` below) ─────────
  const extensionsLogger = logger.child({ component: "extensions-sync" });
  const extensionsService = new ExtensionsService({
    home,
    config,
    logger: extensionsLogger,
    spawn: opts.extensionsInstallSpawn,
    configPath,
  });

  // ── Real provider resolution (pi spawns `pi --mode rpc`; mock is opt-in) ─────
  const resolveClient = (provider: string): AgentClient =>
    resolveProviderClient(provider, config, { logger });

  // ── Disk-persisted agent manager (recovers agents on boot) ───────────────────
  const manager = new AgentManager({
    home,
    saveAgent: (record) => saveAgent(home, record),
    loadAllAgents: () => loadAllAgents(home),
  });

  // ── Broadcast helper ─────────────────────────────────────────────────────────
  // See `wrapSessionEnvelope` above for the full rationale.
  const broadcast = (sessions: Iterable<Session>, message: unknown) => {
    const envelope = wrapSessionEnvelope(message);
    for (const s of sessions) {
      try {
        s.send(envelope);
      } catch {
        /* ignore dead sockets */
      }
    }
  };

  const relaySessions = new Set<Session>();
  const relayCapabilityStore = createInMemoryCapabilityStore();
  const sessionsHolder: { sessions: Iterable<Session> } = { sessions: [] };
  const getActiveSessions = (): Session[] => [...sessionsHolder.sessions, ...relaySessions];

  // Forward archive/delete lifecycle events to every connected client (multi-tab/multi-client
  // sync) — `agent_update` for status changes is already broadcast per-call-site; these two are
  // manager-internal and only reach clients via this subscription.
  manager.subscribe((event) => {
    if (event.type === "agent_archived" || event.type === "agent_deleted") {
      logger.info({ agentId: event.agentId }, event.type.replace("_", " "));
      broadcast(getActiveSessions(), { type: "session", message: event });
    }
  });

  const registry = new HandlerRegistry(logger);

  // ── Core agent/session/timeline/permission handlers ──────────────────────────
  const agentService = new AgentService({ manager, resolveClient, broadcast, logger });
  agentService.registerHandlers(registry, getActiveSessions);

  const sessionOps = new SessionOperationsService({
    manager,
    resolveClient,
    service: agentService,
    broadcast,
  });
  sessionOps.registerHandlers(registry, getActiveSessions);

  const slashCommandOps = new SlashCommandOperationsService({
    manager,
    resolveClient,
    broadcast,
    logger,
  });
  slashCommandOps.registerHandlers(registry, getActiveSessions);

  registerTimelineHandler(registry, { manager, resolveClient });

  const permissionService = new PermissionService({ manager, broadcast });
  permissionService.registerHandlers(registry, getActiveSessions);

  // ── Directory listing (agents) ────────────────────────────────────────────────
  registry.register("list_agents_request", (ctx) => ({
    type: "list_agents_response",
    requestId: ctx.requestId ?? "",
    agents: manager.list().map((m) => ({
      agentId: m.record.id,
      status: m.record.lastStatus,
      title: m.record.labels?.["title"] ?? m.record.title ?? undefined,
      cwd: m.record.cwd,
      labels: m.record.labels ?? {},
      lastActivity: new Date(m.record.updatedAt).getTime(),
      provider: m.record.provider,
      model: m.session?.getRuntimeInfo().model ?? m.record.config?.model,
      modelProvider: m.record.config?.modelProvider,
    })),
  }));

  // ── Archive (soft delete) / delete (hard delete) — real remote deletion for clients ──────────
  registry.register("archive_agent", async (ctx) => {
    const agentId = String(ctx.message.agentId ?? "");
    await manager.archiveAgent(agentId);
    return { type: "archive_agent_response", requestId: ctx.requestId ?? "", agentId, ok: true };
  });
  registry.register("delete_agent", async (ctx) => {
    const agentId = String(ctx.message.agentId ?? "");
    const deleted = await manager.deleteAgent(agentId);
    return {
      type: "delete_agent_response",
      requestId: ctx.requestId ?? "",
      agentId,
      ok: deleted,
    };
  });

  // ── Providers (metadata for the new-agent picker) ────────────────────────────
  const providerRegistry = new ProviderRegistry();
  providerRegistry.replaceMetadata(config);
  registry.register("list_providers", (ctx) => ({
    type: "list_providers_response",
    requestId: ctx.requestId ?? "",
    providers: providerRegistry.listMetadata(),
  }));

  // ── Provider model discovery (sprint-043: composer model selector) ──────────
  registry.register("list_provider_models", async (ctx) => {
    const provider = String(ctx.message.provider ?? "pi");
    const cwd = ctx.message.cwd ? String(ctx.message.cwd) : undefined;
    const client = resolveClient(provider);
    const models = await client.listModels(cwd ? { cwd } : undefined);
    return {
      type: "list_provider_models_response",
      requestId: ctx.requestId ?? "",
      provider,
      models,
    };
  });

  // ── Default-model discovery (deferred-draft preselect: new chats show the model they'll
  // actually run on before anything is spawned) ──────────────────────────────
  const defaultModelCache = new Map<string, { provider?: string; model?: string } | null>();
  registry.register("resolve_default_model", async (ctx) => {
    const provider = String(ctx.message.provider ?? "pi");
    const cwd = ctx.message.cwd ? String(ctx.message.cwd) : undefined;
    const cacheKey = `${provider}:${cwd ?? ""}`;
    let resolved = defaultModelCache.get(cacheKey);
    if (resolved === undefined) {
      const client = resolveClient(provider);
      resolved = client.resolveDefaultModel
        ? await client.resolveDefaultModel(cwd ? { cwd } : undefined)
        : null;
      defaultModelCache.set(cacheKey, resolved);
    }
    return {
      type: "resolve_default_model_response",
      requestId: ctx.requestId ?? "",
      provider,
      model: resolved?.model,
      modelProvider: resolved?.provider,
    };
  });

  // ── Projects / workspaces (real disk registry) ────────────────────────────────
  const workspaceRegistry = new WorkspaceRegistryService(home);
  const openProject = new OpenProjectService({ home, broadcast, registry: workspaceRegistry });
  openProject.registerHandlers(registry, getActiveSessions);

  const statusOf = (cwd: string): "running" | "error" | "idle" => {
    const managed = manager.list().find((m) => m.record.cwd === cwd);
    const s = managed?.record.lastStatus;
    return s === "running" ? "running" : s === "error" ? "error" : "idle";
  };
  registry.register("list_workspaces_request", async (ctx) => {
    const registered = (await workspaceRegistry.listActiveWorkspaces()).map((w) => ({
      workspaceId: w.workspaceId,
      projectId: w.projectId,
      cwd: w.cwd,
      kind: w.kind as "directory" | "git" | "non_git",
      displayName: w.displayName,
      agentStatus: statusOf(w.cwd),
      createdAt: new Date(w.createdAt).getTime(),
      updatedAt: new Date(w.updatedAt ?? w.createdAt).getTime(),
    }));
    // Synthesize a 1:1 workspace for any agent that has no registered workspace
    // (agents created directly via create_agent rather than open_project). This
    // keeps the client's "one workspace per agent" model reachable — without it,
    // clicking an agent in the sidebar hits "Workspace Not Found". workspaceId
    // === agentId for these synthesized entries.
    const knownCwds = new Set(registered.map((w) => w.cwd));
    const knownIds = new Set(registered.map((w) => w.workspaceId));
    const synthesized = manager
      .list()
      .filter((m) => !knownIds.has(m.record.id) && !knownCwds.has(m.record.cwd))
      .map((m) => ({
        workspaceId: m.record.id,
        projectId: "agents",
        cwd: m.record.cwd,
        kind: "directory" as const,
        displayName:
          m.record.labels?.["title"] ??
          m.record.cwd.split("/").filter(Boolean).pop() ??
          m.record.cwd,
        agentStatus: statusOf(m.record.cwd),
        createdAt: new Date(m.record.createdAt).getTime(),
        updatedAt: new Date(m.record.updatedAt).getTime(),
      }));
    return {
      type: "list_workspaces_response",
      requestId: ctx.requestId ?? "",
      workspaces: [...registered, ...synthesized],
    };
  });
  registry.register("list_projects_request", async (ctx) => ({
    type: "list_projects_response",
    requestId: ctx.requestId ?? "",
    projects: (await workspaceRegistry.listActiveProjects()).map((p) => ({
      projectId: p.projectId,
      rootPath: p.rootPath,
      kind: p.kind,
      displayName: p.displayName,
      createdAt: new Date(p.createdAt).getTime(),
      updatedAt: new Date(p.updatedAt).getTime(),
    })),
  }));

  // ── Git: status/diff streaming, operations, GitHub PRs, worktrees ─────────────
  const subscriptions = new SessionSubscriptions();
  const gitService = new WorkspaceGitService();
  const diffManager = new CheckoutDiffManager();
  registerGitCheckoutHandlers(registry, {
    gitService,
    diffManager,
    checkoutRefreshEnabled: true,
    subscriptions,
  });
  new GitOperationsService({ gitService }).registerHandlers(registry);
  new GitHubService({
    setAutoMergeEnabled: true,
    archiveWorkspace: async (workspaceId) => {
      await workspaceRegistry.archiveWorkspace(workspaceId);
    },
  }).registerHandlers(registry);
  new WorktreeService({
    home,
    registry: workspaceRegistry,
    broadcast,
    getActiveSessions,
  }).registerHandlers(registry, getActiveSessions);

  // ── Files: explorer (with download tokens) + transfer + filesystem watch ──────
  const fileTransfer = new FileTransferService();
  new FileExplorerService({ issueDownloadToken: fileTransfer.issueDownloadToken }).registerHandlers(
    registry,
  );
  fileTransfer.registerHandlers(registry);
  const fileTransferBinary = fileTransfer.binaryHandler();
  const fileWatchService = new FileWatchService({ logger });
  registerFileWatchHandlers(registry, { fileWatchService, subscriptions, logger });
  registerExtensionsHandlers(registry, { service: extensionsService, logger: extensionsLogger });

  // Simple file diff RPC for the POC UI (returns unified diff for a single file). Untracked
  // (brand-new) files have no git-tracked "before" state, so a plain `git diff` against them is
  // always empty — git only diffs a path once it's in the index or committed. Fall back to
  // `git diff --no-index /dev/null <path>` (which git-diff-untracked-files-as-added, exit code 1
  // is expected/non-fatal there) so new files render as a full "all lines added" diff instead of
  // a blank tab.
  registry.register("file_diff_request", async (ctx) => {
    const filePath = String(ctx.message.path ?? "");
    const cwd = String(ctx.message.cwd ?? "");
    const staged = Boolean(ctx.message.staged);
    const resolvedCwd = cwd.startsWith("~") ? expandHome(cwd) : cwd || undefined;
    const runGitDiff = (args: string[]) =>
      new Promise<string>((resolve) => {
        execFile("git", args, { cwd: resolvedCwd, maxBuffer: 1024 * 1024 }, (_err, stdout) => {
          resolve(stdout || "");
        });
      });
    const args = ["diff"];
    if (staged) args.push("--staged");
    args.push("--", filePath);
    let patch = await runGitDiff(args);
    if (!patch && !staged) {
      patch = await runGitDiff(["diff", "--no-index", "--", "/dev/null", filePath]);
    }
    return { type: "file_diff_response", ok: true, path: filePath, patch };
  });

  // Simple text file read RPC for the POC UI (returns up to `MAX_INLINE_FILE_READ_BYTES` of
  // UTF-8 text; larger files must use the chunked binary download path instead). Async so a
  // multi-MB read/decode never blocks the event loop — every other session (agent streams,
  // terminal output, heartbeats) shares this thread.
  registry.register("file_read_request", async (ctx) => {
    const filePath = String(ctx.message.path ?? "");
    const resolved = expandHome(filePath);
    try {
      const st = await stat(resolved);
      if (st.isDirectory()) return { type: "file_read_response", ok: false, error: "is_directory" };
      if (st.size > MAX_INLINE_FILE_READ_BYTES)
        return {
          type: "file_read_response",
          ok: false,
          error: "file_too_large",
          size: st.size,
          maxBytes: MAX_INLINE_FILE_READ_BYTES,
        };
      const content = await readFile(resolved, "utf8");
      return { type: "file_read_response", ok: true, path: resolved, content, size: st.size };
    } catch (e: unknown) {
      return {
        type: "file_read_response",
        ok: false,
        error: (e as Error).message ?? "read_failed",
      };
    }
  });

  // ── Service proxy (workspace scripts) ─────────────────────────────────────────
  const serviceProxy = new ServiceProxy(resolveServiceProxyConfig(config.daemon.serviceProxy));

  // ── Terminals: manager + control RPCs + binary stream ─────────────────────────
  const terminalManager = new TerminalManager({ logger });
  registerTerminalHandlers(
    registry,
    {
      manager: terminalManager,
      broadcast,
      restoreModesEnabled: true,
      projectConfigPath: (cwd: string) => join(cwd, "pi-studio.json"),
    },
    getActiveSessions,
  );
  const terminalBinaryHandler = makeTerminalBinaryHandler(terminalManager);

  // ── Orchestration: schedules / chat / loops (real, disk-backed) ───────────────
  const scheduleExecutor: ScheduleExecutor = {
    async createAndPrompt(agentConfig, prompt) {
      const res = (await agentService.handleCreate(
        { config: agentConfig, initialPrompt: prompt, requestId: randomUUID() },
        getActiveSessions,
      )) as { payload?: { agentId?: string } };
      return { agentId: res?.payload?.agentId ?? "" };
    },
    async promptExisting(agentId, prompt) {
      await agentService.handleSendPrompt({ agentId, prompt }, getActiveSessions);
      return {};
    },
  };
  const scheduleService = new ScheduleService({ home, executor: scheduleExecutor });
  const chatService = new ChatService({ home });

  const lastAssistantText = (agentId: string): string | undefined => {
    const rows = getTimeline(agentId)?.allRows() ?? [];
    for (let i = rows.length - 1; i >= 0; i--) {
      const ev = rows[i]!.event as { kind?: string; text?: string };
      // Skip textless `final` block-close markers (`assistant_message.final`) — they carry no
      // text and would otherwise mask the real last reply.
      if (ev.kind === "assistant_message" && ev.text) return ev.text;
    }
    return undefined;
  };
  const loopExecutor: LoopExecutor = {
    async runWorker({ provider, model, modeId, cwd, prompt }) {
      const res = (await agentService.handleCreate(
        {
          config: { provider, cwd, ...(model && { model }), ...(modeId && { modeId }) },
          initialPrompt: prompt,
        },
        getActiveSessions,
      )) as { payload?: { agentId?: string } };
      const agentId = res?.payload?.agentId ?? "";
      const rows = getTimeline(agentId)?.allRows() ?? [];
      const last = rows.at(-1)?.event as { kind?: string } | undefined;
      const outcome: WorkerOutcome =
        last?.kind === "turn_failed" || last?.kind === "error"
          ? "failed"
          : last?.kind === "turn_canceled"
            ? "canceled"
            : "completed";
      return { agentId, outcome, output: lastAssistantText(agentId) };
    },
    runShellCheck(command, cwd) {
      return new Promise((resolve) => {
        execFile(
          "/bin/sh",
          ["-c", command],
          { cwd, windowsHide: true },
          (error, stdout, stderr) => {
            const exitCode =
              error && typeof (error as { code?: unknown }).code === "number"
                ? (error as { code: number }).code
                : error
                  ? 1
                  : 0;
            resolve({ exitCode, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
          },
        );
      });
    },
    async runVerifier({ provider, model, modeId, cwd }, verifyPrompt, workerOutput) {
      const prompt = `${verifyPrompt}\n\n--- Worker output ---\n${workerOutput ?? "(none)"}`;
      const res = (await agentService.handleCreate(
        {
          config: { provider, cwd, ...(model && { model }), ...(modeId && { modeId }) },
          initialPrompt: prompt,
        },
        getActiveSessions,
      )) as { payload?: { agentId?: string } };
      const agentId = res?.payload?.agentId ?? "";
      const text = lastAssistantText(agentId) ?? "";
      const passed =
        /\b(pass|passed|success|succeeded|ok|yes)\b/i.test(text) &&
        !/\b(fail|failed|no)\b/i.test(text);
      return { passed, reason: text.slice(0, 200), agentId };
    },
    async archiveAgent(agentId) {
      await manager.archiveAgent(agentId);
    },
  };
  const loopService = new LoopService({ home, executor: loopExecutor });

  registerOrchestrationHandlers(registry, { scheduleService, chatService, loopService });

  // ── Security: host allowlist + optional password auth ─────────────────────────
  const hostnames = config.daemon.hostnames;
  const hostChecker = createHostChecker(hostnames);
  const passwordHash = resolvePasswordHash({
    configPassword: config.daemon.auth.password,
    envPassword: process.env.PI_STUDIO_PASSWORD,
  });
  const auth = createPasswordAuth(passwordHash);

  // ── HTTP + WS wiring ─────────────────────────────────────────────────────────
  const httpServer = createHttpServer({
    hostnames,
    allowedOrigins: config.daemon.cors.allowedOrigins,
    authenticate: (req) => auth.authenticateHttp(req),
    onRequest: (req, res) => serviceProxy.handleRequest(req, res),
  });

  const wsHandle = createWebSocketServer(httpServer, {
    serverId,
    hostname: opts.host,
    version: "1.0.0",
    auth,
    logger,
    hostCheck: (h) => hostChecker(h),
    onSession: (session) => {
      logger.info(
        { clientId: session.clientId, clientType: session.clientType },
        "ws client connected",
      );
    },
    onSessionClose: (session) => subscriptions.disposeSession(session),
    onMessage: (session, frame) => {
      if ("text" in frame) {
        void routeTextFrame(session, frame.text, registry);
      } else {
        // Binary frames: try terminal (Input/Resize) then file-transfer (upload) decoders.
        routeBinaryFrame(session, frame.binary, (s, bytes) => {
          terminalBinaryHandler(s, bytes);
          fileTransferBinary(s, bytes);
        });
      }
    },
  });

  sessionsHolder.sessions = wsHandle.sessions;

  // ── Optional outbound relay (architecture/relay-e2ee.md, architecture/daemon-bootstrap.md
  // § Behavior — `connectRelay`). Fully opt-in: `config.daemon.relay.enabled` defaults to false,
  // so a daemon with no relay config behaves identically to before — only the direct WS listener
  // above ever starts. When enabled, each decrypted relay app message is dispatched through the
  // exact same `registry`/`routeTextFrame` RPC surface direct clients use, via a persistent
  // synthetic `Session` whose `send()` re-encrypts the response back onto the same E2EE channel.
  //
  // A relay session id pairs at most one client with this daemon at a time (`RelaySessionBridge`),
  // so exactly one `Session` is live per relay connection — created lazily on the client's `hello`
  // (mirroring `ws-server.ts`'s direct-WS handshake exactly: validate `hello`, rehydrate/persist
  // capabilities by `clientId`, reply with `status`/`server_info`), then reused for every
  // subsequent frame until the relay reconnects with a new session id.
  let relayHandle: RelayTransportHandle | undefined;
  if (config.daemon.relay.enabled) {
    let relaySession: Session | null = null;
    let relayReply: ((data: string) => void) | null = null;
    let relayReplyBinary: ((bytes: Uint8Array) => void) | null = null;

    const resetRelaySession = (): void => {
      if (relaySession) relaySessions.delete(relaySession);
      relaySession = null;
    };

    relayHandle = connectRelay(
      {
        publicKey: Buffer.from(daemonKeypairB64.publicKeyB64, "base64"),
        secretKey: Buffer.from(daemonKeypairB64.secretKeyB64, "base64"),
      },
      config.daemon.relay,
      {
        onMessage: (plaintext, reply) => {
          relayReply = reply; // kept in sync per message too; the real fix is capturing this in onHandshake below

          if (relaySession === null) {
            // First frame on this relay connection must be `hello`, exactly like direct WS.
            let parsed: unknown;
            try {
              parsed = JSON.parse(plaintext);
            } catch {
              return; // not JSON — ignore, matching routeTextFrame's tolerance
            }
            const hello = helloSchema.safeParse(parsed);
            if (!hello.success) return; // non-hello first frame: ignore (no socket to close)

            const stored = relayCapabilityStore.get(hello.data.clientId);
            const capabilities = hello.data.capabilities ?? stored ?? {};
            relayCapabilityStore.set(hello.data.clientId, capabilities);

            relaySession = new Session({
              id: randomUUID(),
              clientId: hello.data.clientId,
              clientType: hello.data.clientType,
              capabilities,
              // `Session.send()` calls `socket.send(jsonString)`; `Session.sendBinary()` calls
              // `socket.send(bytes)` — same method, discriminated by argument type here so both
              // funnel to the matching relay reply callback (text `e2ee_app` vs binary `e2ee_bin`).
              socket: {
                send: (data: string | Uint8Array) => {
                  if (typeof data === "string") relayReply?.(data);
                  else relayReplyBinary?.(data);
                },
                close: () => {},
              } as unknown as ConstructorParameters<typeof Session>[0]["socket"],
            });
            relaySessions.add(relaySession);
            logger.info(
              {
                clientId: relaySession.clientId,
                clientType: relaySession.clientType,
                via: "relay",
              },
              "ws client connected",
            );

            const payload = serverInfoPayloadSchema.parse({
              status: "server_info",
              serverId,
              hostname: opts.host,
              version: "1.0.0",
              capabilities: {},
              features: Object.fromEntries(Object.values(SERVER_FEATURES).map((k) => [k, true])),
            });
            relaySession.send(statusSchema.parse({ type: "status", payload }));
            return;
          }

          void routeTextFrame(relaySession, plaintext, registry);
        },
        onBinaryMessage: (bytes, replyBinary) => {
          relayReplyBinary = replyBinary; // kept in sync per message too; the real fix is capturing this in onHandshake below
          if (relaySession === null) return; // binary frames before `hello` have no session to target
          routeBinaryFrame(relaySession, bytes, (s, b) => {
            terminalBinaryHandler(s, b);
            fileTransferBinary(s, b);
          });
        },
        onError: (err) => {
          logger.error({ err: (err as Error)?.message ?? String(err) }, "relay channel error");
        },
        onSessionStart: (sessionId) => {
          logger.info({ sessionId }, "relay connected");
        },
        onHandshake: (reply, replyBinary) => {
          // A NEW peer just completed the E2EE handshake on this (possibly already-`ready`)
          // channel — browser reload, second tab, or a genuine reconnect all look identical here.
          // Drop any app-level Session tied to whichever peer held the channel before; the next
          // app frame is that new peer's own `hello`, not a continuation of the old one's.
          //
          // Capture `reply`/`replyBinary` right here rather than waiting for the first
          // `onMessage`/`onBinaryMessage` call: a file download's `Begin`/`Chunk`/`End` frames are
          // sent daemon → client entirely unprompted (the client never sends binary first, unlike
          // terminal input), so `relayReplyBinary` used to stay `null` until a binary frame
          // happened to arrive from the client — which never happened for downloads, silently
          // dropping every relay-routed file download with no error on either side.
          relayReply = reply;
          relayReplyBinary = replyBinary;
          if (relaySession) logger.info({ sessionId: relaySession.id }, "relay peer replaced");
          resetRelaySession();
        },
        onReconnect: (sessionId) => {
          logger.info({ sessionId }, "relay reconnecting with new session");
          resetRelaySession();
          relayReply = null;
          relayReplyBinary = null;
        },
      },
    );
  }

  // Recover persisted agents on boot (best-effort; provider sessions are re-attached lazily).
  void manager.recover().then(
    (recovered) => {
      logger.info({ recovered }, "agent recovery complete");
    },
    (err: unknown) => {
      logger.error({ err: (err as Error)?.message ?? String(err) }, "agent recovery failed");
    },
  );

  // Fail cleanly on a bind error (e.g. EADDRINUSE) instead of an unhandled 'error' throw.
  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.error({ host: opts.host, port: opts.port }, "cannot bind — address already in use");
    } else {
      logger.error({ err: err.message }, "http server error");
    }
    process.exitCode = 1;
    void wsHandle.close().finally(() => process.exit(1));
  });

  httpServer.listen(opts.port, opts.host);
  logger.info({ host: opts.host, port: opts.port }, "http/ws server accepting connections");

  // Fire-and-forget: never delays daemon readiness, never blocks the return below. Mirrors the
  // agent-recovery block above, but deliberately kicked off AFTER listen() rather than before —
  // extensions sync is optional-and-loud, agent recovery is required-for-correctness.
  void extensionsService.sync("bootstrap").catch((err: unknown) => {
    extensionsLogger.error(
      { err: (err as Error)?.message ?? String(err) },
      "extensions sync failed",
    );
  });

  return {
    httpServer,
    serverId,
    home,
    provider: "pi",
    logger,
    close: async () => {
      logger.info("daemon shutting down");
      terminalManager.killAll();
      fileWatchService.close();
      relayHandle?.close();
      await wsHandle.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
