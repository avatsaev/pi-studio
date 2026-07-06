/**
 * Dev bootstrap — wires HTTP + WS server + HandlerRegistry + in-memory agent
 * services for local development. Not for production (in-memory persistence,
 * mock provider only, no auth).
 *
 * See: AGENTS.md "RPC handler registration is explicit" — this is that
 * bootstrap module.
 */
import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { createHttpServer } from "../http/http-server.js";
import { createWebSocketServer } from "../ws/ws-server.js";
import { HandlerRegistry, routeTextFrame } from "../ws/router.js";
import type { Session } from "../ws/session.js";
import { AgentManager } from "../agent/agent-manager.js";
import { AgentService } from "../agent/agent-service.js";
import { SessionOperationsService } from "../agent/session-operations.js";
import { registerTimelineHandler } from "../agent/timeline-rpc.js";
import { PermissionService } from "../agent/permissions.js";
import { createMockClient } from "../agent/providers/mock/mock-provider.js";
import { ProviderRegistry } from "../agent/provider-registry.js";
import { FileExplorerService } from "../files/file-explorer.js";
import type { AgentClient } from "../agent/provider-contract.js";
import type { AgentRecord } from "../persistence/entity-schemas.js";

export interface DevBootstrapOptions {
  host: string;
  port: number;
  serverId?: string;
  hostnames?: true | string[];
}

export interface DevBootstrapHandle {
  httpServer: HttpServer;
  serverId: string;
  close(): Promise<void>;
}

export function startDevDaemon(opts: DevBootstrapOptions): DevBootstrapHandle {
  const serverId = opts.serverId ?? randomUUID();

  // ── In-memory agent manager (no disk persistence in dev mode) ──────────────
  const agentsById = new Map<string, AgentRecord>();
  const manager = new AgentManager({
    home: "/tmp/pi-studio-dev",
    saveAgent: async (record) => {
      agentsById.set(record.id, record);
    },
    loadAllAgents: async () => [...agentsById.values()],
  });

  // ── Provider resolution: mock only in dev ───────────────────────────────────
  const mockClient = createMockClient();
  const resolveClient = (_provider: string): AgentClient => mockClient;

  // ── Broadcast helper ─────────────────────────────────────────────────────────
  const broadcast = (sessions: Iterable<Session>, message: unknown) => {
    for (const s of sessions) {
      try {
        s.send(message);
      } catch {
        /* ignore send errors on dead sockets */
      }
    }
  };

  // Session set is created by the WS server below; handlers close over this
  // mutable holder so they can be registered before the WS server exists.
  const sessionsHolder: { sessions: Iterable<Session> } = { sessions: [] };
  const getActiveSessions = () => sessionsHolder.sessions;

  // ── Handler registry ────────────────────────────────────────────────────────
  const registry = new HandlerRegistry();

  const agentService = new AgentService({ manager, resolveClient, broadcast });
  agentService.registerHandlers(registry, getActiveSessions);

  const sessionOps = new SessionOperationsService({
    manager,
    resolveClient,
    service: agentService,
    broadcast,
  });
  sessionOps.registerHandlers(registry, getActiveSessions);

  registerTimelineHandler(registry);

  const permissionService = new PermissionService({ manager, broadcast });
  permissionService.registerHandlers(registry, getActiveSessions);

  // ── list_agents_request: minimal directory listing (not in scope elsewhere) ─
  registry.register("list_agents_request", (ctx) => {
    const agents = manager.list().map((m) => ({
      agentId: m.record.id,
      status: m.record.lastStatus,
      title: m.record.labels?.["title"] ?? undefined,
      cwd: m.record.cwd,
      labels: m.record.labels ?? {},
      lastActivity: new Date(m.record.updatedAt).getTime(),
    }));
    return {
      type: "list_agents_response",
      requestId: ctx.requestId ?? "",
      agents,
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
      agentStatus: m.record.lastStatus === "running" ? "running" : m.record.lastStatus === "error" ? "error" : "idle",
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

  // ── File explorer: real directory listing + file preview from disk ───────
  // (features/file-explorer-transfer.md). Lets the workspace Explorer + file
  // preview panes show actual files.
  new FileExplorerService().registerHandlers(registry);
  registry.register("schedule_list_request", (ctx) => ({
    type: "schedule_list_response",
    requestId: ctx.requestId ?? "",
    schedules: [],
  }));

  // ── HTTP + WS wiring ─────────────────────────────────────────────────────────
  const hostnames = opts.hostnames ?? true;
  const httpServer = createHttpServer({ hostnames });

  const wsHandle = createWebSocketServer(httpServer, {
    serverId,
    hostname: opts.host,
    version: "0.1.0-dev",
    onSession: (session) => {
      console.log(`[ws] client connected: ${session.clientId} (${session.clientType})`);
    },
    onMessage: (session, frame) => {
      if ("text" in frame) {
        void routeTextFrame(session, frame.text, registry);
      }
      // Binary (terminal) frames not wired in dev bootstrap yet.
    },
  });

  // Now that the WS server exists, point the holder at its live session set.
  sessionsHolder.sessions = wsHandle.sessions;

  httpServer.listen(opts.port, opts.host);

  return {
    httpServer,
    serverId,
    close: async () => {
      await wsHandle.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
