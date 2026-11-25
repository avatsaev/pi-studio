/**
 * Dev bootstrap — wires HTTP + WS server + HandlerRegistry + in-memory agent
 * services for local development. Not for production (in-memory persistence,
 * mock provider only, no auth).
 *
 * See: AGENTS.md "RPC handler registration is explicit" — this is that
 * bootstrap module.
 */
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import type { Server as HttpServer } from "node:http";
import { join } from "node:path";
import { expandHome } from "../files/resolve-path.js";
import { createHttpServer } from "../http/http-server.js";
import { createWebSocketServer } from "../ws/ws-server.js";
import { HandlerRegistry, routeBinaryFrame, routeTextFrame } from "../ws/router.js";
import type { Session } from "../ws/session.js";
import { registerAgentUiHandlers } from "../agent/agent-ui/agent-ui-rpc.js";
import { AgentUiService } from "../agent/agent-ui/agent-ui-service.js";
import { registerAgentTodosHandlers } from "../agent/agent-todos/agent-todos-rpc.js";
import { AgentTodosService } from "../agent/agent-todos/agent-todos-service.js";
import { AgentManager } from "../agent/agent-manager.js";
import { AgentService } from "../agent/agent-service.js";
import { deterministicFallback } from "../agent/structured-generation.js";
import { SessionOperationsService } from "../agent/session-operations.js";
import { SlashCommandOperationsService } from "../agent/slash-command-operations.js";
import { registerTimelineHandler } from "../agent/timeline-rpc.js";
import { createMockClient } from "../agent/providers/mock/mock-provider.js";
import { ProviderRegistry } from "../agent/provider-registry.js";
import { FileExplorerService } from "../files/file-explorer.js";
import { FileTransferService } from "../files/file-transfer.js";
import { MAX_INLINE_FILE_READ_BYTES } from "../files/limits.js";
import type { AgentClient } from "../agent/provider-contract.js";
import type { AgentRecord } from "../persistence/entity-schemas.js";
import { LogTap } from "../logging/log-tap.js";
import { createDaemonLogger, type Logger } from "../logging/logger.js";
import { registerDaemonLogsHandlers } from "../observability/daemon-logs-rpc.js";
import { DaemonLogsService } from "../observability/daemon-logs-service.js";
import { registerDaemonStatusHandlers } from "../observability/daemon-status-rpc.js";
import { DaemonStatusService } from "../observability/daemon-status-service.js";
import { TerminalManager } from "../terminal/terminal-manager.js";
import { makeTerminalBinaryHandler, registerTerminalHandlers } from "../terminal/terminal-rpc.js";
import { registerViewerSettingsHandlers } from "../viewers/viewer-settings-rpc.js";
import { SERVER_VERSION } from "../version.js";
import { wrapSessionEnvelope } from "./bootstrap.js";
import { registerDaemonUpdateHandlers } from "../update/update-rpc.js";
import {
  DEV_UPDATE_STEP_MS,
  DevUpdateScriptRuntime,
  parseDevUpdateScript,
  type DevUpdateScript,
} from "../update/dev-update-script.js";
import { UpdateService } from "../update/update-service.js";
import { isLoopbackHost, unprotectedBindError } from "./loopback.js";

export interface DevBootstrapOptions {
  host: string;
  port: number;
  serverId?: string;
  hostnames?: true | string[];
  /** Operational logger. Defaults to a stdout dev logger (`PI_STUDIO_LOG_LEVEL`, pretty on a TTY). */
  logger?: Logger;
  /**
   * Live log-stream tap (daemon log streaming). Defaults to a fresh `LogTap` attached to the
   * logger the bootstrap builds itself; when `logger` is injected the caller must have passed the
   * same tap to `createLogger({tap})` (an injected logger without it streams nothing).
   */
  logTap?: LogTap;
  /**
   * Delay (ms) before a mock turn auto-completes (`MockSessionOptions.turnDelayMs`). Defaults to
   * the mock provider's own default (5ms) — long enough for `interrupt` to win a race, too short
   * to observe "running" state by hand. Bump this for manual UI testing of running-state behavior
   * (spinners, Stop, Steer) against the dev daemon.
   */
  mockTurnDelayMs?: number;
  /**
   * Scripted self-update (`PI_STUDIO_DEV_UPDATE`). `undefined` reads the env var; `null` forces the
   * unscripted answer (kind `source`, nothing newer).
   */
  updateScript?: DevUpdateScript | null;
  /** Pause between the scripted apply steps (ms). Default 1500; tests pass a few ms. */
  updateStepMs?: number;
}

export interface DevBootstrapHandle {
  httpServer: HttpServer;
  serverId: string;
  logger: Logger;
  /** Exposed for tests only (e.g. sprint-066/task-004's daemon-level extension-UI test): lets a
   *  test reach a created agent's live `MockAgentSession` to script a UI dialog via
   *  `emitUiRequest` — there is no WS RPC for that, by design (a real Pi process is what would
   *  normally emit these). Not part of the RPC surface. */
  manager: AgentManager;
  close(): Promise<void>;
}

/** Vite dev origins: web development keeps working; every other `Origin` is refused. */
const DEV_ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

/** Broadcast helper — see `bootstrap.ts`'s `wrapSessionEnvelope` for the full rationale. */
function broadcast(sessions: Iterable<Session>, message: unknown): void {
  const envelope = wrapSessionEnvelope(message);
  for (const s of sessions) {
    try {
      s.send(envelope);
    } catch {
      /* ignore send errors on dead sockets */
    }
  }
}
export function startDevDaemon(opts: DevBootstrapOptions): DevBootstrapHandle {
  // The dev daemon has no auth at all, so it never accepts a bind beyond this machine.
  if (!isLoopbackHost(opts.host)) {
    const err = unprotectedBindError(opts.host, opts.port);
    const logger =
      opts.logger ?? createDaemonLogger(undefined, { tap: opts.logTap ?? new LogTap() });
    logger.error({ host: opts.host, port: opts.port, code: err.code }, err.message);
    process.exitCode = 1;
    throw err;
  }
  const serverId = opts.serverId ?? randomUUID();
  const logTap = opts.logTap ?? new LogTap();
  const logger = opts.logger ?? createDaemonLogger(undefined, { tap: logTap });

  // Services receive `getActiveSessions` backed by the module-level `broadcast` (hoisted
  // above) and a mutable holder so they can be registered before the WS server exists.
  const sessionsHolder: { sessions: Iterable<Session> } = { sessions: [] };
  const getActiveSessions = () => sessionsHolder.sessions;

  // ── Extension UI bridge (features/extension-ui-rpc.md) — constructed before the manager so
  // `onSessionAttached` below can close over it. Registered here (unlike production-only
  // `provider_auth`/`file_watch`): the mock provider is this family's designated producer, and the
  // dev daemon is mock-only, so a UI family unexercisable here would be untestable exactly where a
  // sibling UI scope needs to develop against it.
  const agentUiService = new AgentUiService({ broadcast, getActiveSessions, logger });

  // ── Agent todos (features/agent-todos.md) — registered in dev for the same reason as the UI
  // bridge: the mock provider is the scripted producer (`#todo …` prompts). `manager` and
  // `resolveClient` are declared below, so both are read lazily.
  const agentTodosService = new AgentTodosService({
    broadcast,
    getActiveSessions,
    getAgent: (agentId) => manager.get(agentId),
    resolveClient: (provider) => resolveClient(provider),
    logger,
  });

  // ── Daemon status (features/daemon-status-rpc.md) — reads agents lazily through `manager`.
  const daemonStatusService = new DaemonStatusService({
    listAgents: () => manager.list(),
    getActiveSessions: () => [...getActiveSessions()],
    send: (session, envelope) => session.send(envelope),
    logger: logger.child({ component: "daemon-status" }),
  });

  // ── Daemon log streaming (features/daemon-log-streaming.md)
  const daemonLogsService = new DaemonLogsService({
    tap: logTap,
    send: (session, envelope) => session.send(envelope),
  });

  // ── In-memory agent manager (no disk persistence in dev mode) ──────────────
  const agentsById = new Map<string, AgentRecord>();
  const manager = new AgentManager({
    home: "/tmp/pi-studio-dev",
    saveAgent: async (record) => {
      agentsById.set(record.id, record);
    },
    loadAllAgents: async () => [...agentsById.values()],
    deleteAgent: async (_cwd, id) => agentsById.delete(id),
    // `onSessionAttached` is a single slot: compose every bridge that watches a new session.
    onSessionAttached: (agentId, session) => {
      agentUiService.attach(agentId, session);
      agentTodosService.attach(agentId, session);
    },
    logger,
  });

  // ── Provider resolution: mock only in dev ───────────────────────────────────
  const mockClient = createMockClient({ turnDelayMs: opts.mockTurnDelayMs });
  const resolveClient = (_provider: string): AgentClient => mockClient;

  // Forward archive/delete lifecycle events to every connected client (see bootstrap.ts's
  // production twin for the full rationale). Also sweeps the extension-UI bridge: every pending
  // dialog and retained surface for the agent is cancelled/dropped on archive or delete.
  manager.subscribe((event) => {
    if (event.type === "agent_archived" || event.type === "agent_deleted") {
      broadcast(getActiveSessions(), { type: "session", message: event });
      agentUiService.sweep(event.agentId, "aborted");
      agentTodosService.sweep(event.agentId);
    }
  });

  // ── Handler registry ────────────────────────────────────────────────────────
  const registry = new HandlerRegistry(logger);

  // Deterministic-only titler — never constructs a real ModelRuntime (this bootstrap's whole
  // point is to never touch the developer's real ~/.pi/agent credential tree). Still exercises
  // the full write path (record.title + agent_update broadcast) end to end for dev/mock sessions.
  const agentService = new AgentService({
    manager,
    resolveClient,
    broadcast,
    logger,
    generateAgentTitle: async ({ prompt }) => deterministicFallback("agent_title", { prompt }),
  });
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
    onTimelineReset: (agentId) => agentTodosService.reconcile(agentId),
  });
  slashCommandOps.registerHandlers(registry, getActiveSessions);

  registerTimelineHandler(registry, { manager, resolveClient });

  registerAgentUiHandlers(registry, { service: agentUiService, logger });
  registerAgentTodosHandlers(registry, { service: agentTodosService });
  registerDaemonStatusHandlers(registry, { service: daemonStatusService });
  registerDaemonLogsHandlers(registry, { service: daemonLogsService });

  // ── Daemon self-update (features/self-update.md) from a script (`PI_STUDIO_DEV_UPDATE`): no npm,
  // no helper, nothing on disk. The restart is simulated in this process: every socket is dropped,
  // the HTTP listener (same port) stays up, and a fresh `UpdateService` + handlers + handshake
  // version take over, reporting the post-update version and the scripted `lastResult`.
  let autoCheck = true;
  const createUpdateService = (): UpdateService =>
    new UpdateService({
      currentVersion: updateRuntime.version,
      ...updateRuntime.deps(),
      autoCheck,
      persistAutoCheck: async (enabled) => {
        autoCheck = enabled;
        return enabled;
      },
      broadcast: (status) =>
        broadcast(getActiveSessions(), { type: "daemon_update_status", status }),
      logger,
    });
  const updateRuntime: DevUpdateScriptRuntime = new DevUpdateScriptRuntime({
    script:
      opts.updateScript === undefined
        ? parseDevUpdateScript(process.env.PI_STUDIO_DEV_UPDATE)
        : (opts.updateScript ?? undefined),
    baseVersion: SERVER_VERSION,
    stepMs: opts.updateStepMs ?? DEV_UPDATE_STEP_MS,
    restart: () => {
      updateService.close();
      for (const session of wsHandle.sessions) session.close(1001, "daemon restarting");
      updateService = createUpdateService();
      registerDaemonUpdateHandlers(registry, { service: updateService });
      void updateService.start();
    },
  });
  let updateService = createUpdateService();
  registerDaemonUpdateHandlers(registry, { service: updateService });
  /** The current status right after `server_info`, as the production handshake does. */
  const sendUpdateStatus = (session: Session): void => {
    try {
      session.send(
        wrapSessionEnvelope({ type: "daemon_update_status", status: updateService.status() }),
      );
    } catch {
      /* dead socket */
    }
  };

  // Unlike extensions (production-only), this subsystem must exist in dev: the web client is
  // developed against the dev daemon, and without it every dev session runs the
  // capability-absent degrade path and can never exercise the toggle.
  registerViewerSettingsHandlers(registry, {
    home: "/tmp/pi-studio-dev",
    broadcast,
    getActiveSessions,
    logger: logger.child({ component: "viewer-settings" }),
  });

  // ── list_agents_request: minimal directory listing (not in scope elsewhere) ─
  registry.register("list_agents_request", (ctx) => {
    const agents = manager.list().map((m) => ({
      agentId: m.record.id,
      status: m.record.lastStatus,
      title: m.record.labels?.["title"] ?? m.record.title ?? undefined,
      cwd: m.record.cwd,
      labels: m.record.labels ?? {},
      lastActivity: new Date(m.record.updatedAt).getTime(),
      provider: m.record.provider,
      model: m.session?.getRuntimeInfo().model ?? m.record.config?.model,
      modelProvider: m.record.config?.modelProvider,
      thinkingLevel: m.session?.getRuntimeInfo().thinkingLevel ?? m.record.config?.thinkingOptionId,
    }));
    return {
      type: "list_agents_response",
      requestId: ctx.requestId ?? "",
      agents,
    };
  });

  // ── Archive (soft delete) / delete (hard delete) ────────────────────────────
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

  // ── list_workspaces_request: dev-mode 1:1 synthesis ─────────────────────────
  // There is no real workspace registry in this dev bootstrap (that's the full
  // sprint-008 projects/workspaces feature). Until that's wired, synthesize
  // one workspace per known agent (workspaceId === agentId) so the client's
  // workspace-route-gate (features/workspace-ui.md § Route gating) has a
  // `knownWorkspaceIds` entry to resolve against instead of always gating on
  // "missing". TODO(verify): replace with the real WorkspaceRegistry once
  // sprint-008's daemon-side projects/workspaces feature is implemented.
  registry.register("list_workspaces_request", (ctx) => {
    const workspaces = manager.list().map((m) => ({
      workspaceId: m.record.id,
      projectId: "dev-project",
      cwd: m.record.cwd,
      kind: "directory" as const,
      displayName: m.record.labels?.["title"] ?? m.record.cwd,
      agentStatus:
        m.record.lastStatus === "running"
          ? "running"
          : m.record.lastStatus === "error"
            ? "error"
            : "idle",
      createdAt: new Date(m.record.createdAt).getTime(),
      updatedAt: new Date(m.record.updatedAt).getTime(),
    }));
    return {
      type: "list_workspaces_response",
      requestId: ctx.requestId ?? "",
      workspaces,
    };
  });
  registry.register("list_projects_request", (ctx) => ({
    type: "list_projects_response",
    requestId: ctx.requestId ?? "",
    projects: [],
  }));

  // ── list_providers: expose the provider registry manifest (metadata only) ───
  // The client's new-agent provider/profile picker (sprint-030 task-002) reads
  // this to populate its provider + mode dropdowns. Metadata only — no client is
  // constructed or launched here. features/agent-providers.md § Registration surface.
  const providerRegistry = new ProviderRegistry();
  registry.register("list_providers", (ctx) => ({
    type: "list_providers_response",
    requestId: ctx.requestId ?? "",
    providers: providerRegistry.listMetadata(),
  }));

  const defaultModelCache = new Map<
    string,
    { provider?: string; model?: string; thinkingLevel?: string } | null
  >();
  // ── Default-model discovery (deferred-draft preselect) ───────────────────
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
      thinkingLevel: resolved?.thinkingLevel,
    };
  });

  // ── File explorer: real directory listing + file preview from disk ───────
  // (features/file-explorer-transfer.md). Lets the workspace Explorer + file
  // preview panes show actual files.
  //
  // Same wiring as production `bootstrap.ts`: the transfer service owns the download / upload RPCs
  // and the upload binary handler.
  const fileTransfer = new FileTransferService();
  new FileExplorerService().registerHandlers(registry);
  fileTransfer.registerHandlers(registry);
  const fileTransferBinary = fileTransfer.binaryHandler();

  // ── Terminals: manager + control RPCs + binary stream (same wiring as production) ──────────
  const terminalManager = new TerminalManager({ logger });
  registerTerminalHandlers(
    registry,
    {
      manager: terminalManager,
      broadcast,
      projectConfigPath: (cwd: string) => join(cwd, "pi-studio.json"),
    },
    getActiveSessions,
  );
  const terminalBinaryHandler = makeTerminalBinaryHandler(
    terminalManager,
    broadcast,
    getActiveSessions,
  );

  // Simple file diff RPC for the POC UI. Untracked (brand-new) files have no git-tracked "before"
  // state, so a plain `git diff` against them is always empty — git only diffs a path once it's
  // in the index or committed. Fall back to `git diff --no-index /dev/null <path>` (exit code 1
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
  // multi-MB read/decode never blocks the event loop.
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

  // ── HTTP + WS wiring ─────────────────────────────────────────────────────────
  const hostnames = opts.hostnames ?? true;
  const httpServer = createHttpServer({ hostnames });

  const wsHandle = createWebSocketServer(httpServer, {
    serverId,
    allowedOrigins: DEV_ALLOWED_ORIGINS,
    hostname: opts.host,
    // A getter: the simulated restart changes the version new handshakes report.
    get version() {
      return updateRuntime.version;
    },
    logger,
    onSession: (session) => {
      logger.info(
        { clientId: session.clientId, clientType: session.clientType },
        "ws client connected",
      );
      sendUpdateStatus(session);
    },
    onSessionClose: (session) => {
      daemonStatusService.disposeSession(session);
      daemonLogsService.disposeSession(session);
      fileTransfer.disposeSession(session);
    },
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

  // Now that the WS server exists, point the holder at its live session set.
  sessionsHolder.sessions = wsHandle.sessions;

  httpServer.listen(opts.port, opts.host);
  void updateService.start();

  return {
    httpServer,
    serverId,
    logger,
    manager,
    close: async () => {
      logger.info("dev daemon shutting down");
      updateService.close();
      await manager.closeAll();
      daemonStatusService.dispose();
      terminalManager.killAll();
      daemonLogsService.dispose();
      await wsHandle.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
