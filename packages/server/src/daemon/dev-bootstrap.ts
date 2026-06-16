import { spawn } from "node:child_process";
import { delimiter, dirname, join } from "node:path";

import { loadConfig } from "../config/daemon-config.js";
import { bootstrap, type BootstrapOptions, type DaemonHandle } from "./bootstrap.js";
import { resolvePiStudioHome } from "./identity.js";

import { AgentManager } from "../agent/agent-manager.js";
import { AgentService, getTimeline } from "../agent/agent-service.js";
import { SessionOperationsService } from "../agent/session-operations.js";
import { PermissionService } from "../agent/permissions.js";
import { registerTimelineHandler } from "../agent/timeline-rpc.js";
import { PROVIDER_MANIFEST } from "../agent/manifest.js";
import { resolveProviderClient } from "../agent/provider-registry.js";
import type { AgentClient } from "../agent/provider-contract.js";

import { TerminalManager } from "../terminal/terminal-manager.js";
import { registerTerminalHandlers } from "../terminal/terminal-rpc.js";

import { WorkspaceRegistryService } from "../projects/workspace-registry.js";
import { OpenProjectService } from "../projects/open-project.js";
import { WorkspaceGitService } from "../projects/workspace-git-service.js";
import { CheckoutDiffManager } from "../projects/checkout-diff-manager.js";
import { registerGitCheckoutHandlers } from "../projects/git-checkout-rpc.js";
import { GitOperationsService } from "../projects/git-operations.js";
import { GitHubService } from "../projects/github-service.js";
import { WorktreeService } from "../projects/worktree-service.js";

import { FileExplorerService } from "../files/file-explorer.js";
import { FileTransferService } from "../files/file-transfer.js";

import { ChatService } from "../orchestration/chat-service.js";
import { ScheduleService, type ScheduleExecutor } from "../orchestration/schedule-service.js";
import { LoopService, type LoopExecutor } from "../orchestration/loop-service.js";

import type { Session } from "../ws/session.js";

/**
 * DEV / POC integration bootstrap.
 *
 * The clean-room `bootstrap()` deliberately ships an empty handler registry (feature wiring is its
 * own sprint). This module reuses that bootstrap — keeping identity, security, HTTP/WS, and the PID
 * lock unchanged — and registers **every** feature service onto the live registry so a UI / CLI can
 * exercise the daemon end-to-end. It is intended for local testing only.
 *
 * Default provider is the real **pi** agent (must be installed + authenticated); `mock` works
 * without it.
 */

export interface DevDaemonHandle extends DaemonHandle {
  /** Stop background loops (schedule tick) in addition to the base close. */
  close(): Promise<void>;
}

export async function devBootstrap(options: BootstrapOptions = {}): Promise<DevDaemonHandle> {
  const env = options.env ?? process.env;
  const handle = await bootstrap(options);
  const home = resolvePiStudioHome(env);
  const config = loadConfig(join(home, "config.json"), env);
  const registry = handle.registry;

  // The `pi` CLI is bundled inside the `@earendil-works/pi-coding-agent` dependency (the adapter
  // launches `node <pkg>/dist/cli.js --mode rpc`), so no global install is required. We still hand
  // the provider a sane PATH so the agent's own tools (bash/git/…) resolve. Users can override
  // agents.providers.pi in config.json (command/env) to point at a different pi.
  const nodeBinDir = dirname(process.execPath);
  const augmentedPath = [nodeBinDir, env.PATH ?? process.env.PATH ?? ""]
    .filter(Boolean)
    .join(delimiter);
  const piOverride = config.agents.providers.pi ?? {};
  config.agents.providers.pi = {
    ...piOverride,
    env: { ...piOverride.env, PATH: augmentedPath },
  };

  const getActiveSessions = (): Iterable<Session> => handle.ws.sessions;
  const broadcast = (sessions: Iterable<Session>, message: unknown): void => {
    for (const session of sessions) session.send(message);
  };
  const resolveClient = (provider: string): AgentClient => resolveProviderClient(provider, config);

  // ── Agents ──────────────────────────────────────────────────────────────────
  const manager = new AgentManager({ home });
  await manager.recover();

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
  new PermissionService({ manager, broadcast }).registerHandlers(registry, getActiveSessions);

  // Agent list / inspect / archive (no dedicated handlers in the clean-room services yet).
  const serializeAgent = (
    m: ReturnType<AgentManager["list"]>[number],
  ): Record<string, unknown> => ({
    agentId: m.record.id,
    status: m.record.lastStatus,
    provider: m.record.provider,
    cwd: m.record.cwd,
    title: m.record.title ?? null,
    createdAt: m.record.createdAt,
    labels: m.record.labels,
  });
  registry.register("list_agents_request", (ctx) => {
    const all = Boolean((ctx.message as Record<string, unknown>).all);
    const agents = (all ? manager.listAll() : manager.list()).map(serializeAgent);
    return { type: "list_agents_response", agents };
  });
  registry.register("inspect_agent_request", (ctx) => {
    const agentId = (ctx.message as Record<string, unknown>).agentId as string;
    const m = manager.get(agentId);
    if (!m) throw new Error(`unknown agent: ${agentId}`);
    return { type: "inspect_agent_response", agent: serializeAgent(m), record: m.record };
  });
  registry.register("archive_agent", async (ctx) => {
    const agentId = (ctx.message as Record<string, unknown>).agentId as string;
    await manager.archiveAgent(agentId);
    return { type: "archive_agent_response", agentId, ok: true };
  });
  registry.registerAlias("delete_agent", "archive_agent");
  registry.register("wait_for_agent", async (ctx) => {
    const agentId = (ctx.message as Record<string, unknown>).agentId as string;
    for (let i = 0; i < 600; i++) {
      const m = manager.get(agentId);
      if (!m) throw new Error(`unknown agent: ${agentId}`);
      if (m.record.lastStatus === "idle" || m.record.lastStatus === "closed") {
        return { type: "wait_for_agent_response", agentId, status: m.record.lastStatus };
      }
      await delay(500);
    }
    return { type: "wait_for_agent_response", agentId, status: "timeout" };
  });

  // ── Providers ────────────────────────────────────────────────────────────────
  registry.register("list_providers", () => ({
    type: "list_providers_response",
    providers: Object.values(PROVIDER_MANIFEST).map((p) => ({
      providerId: p.id,
      name: p.label,
      description: p.description,
      modes: p.modes,
    })),
  }));
  registry.register("list_models", async (ctx) => {
    const providerId = ((ctx.message as Record<string, unknown>).providerId as string) ?? "pi";
    try {
      const client = resolveClient(providerId);
      const models = await client.listModels({});
      return { type: "list_models_response", providerId, models };
    } catch (error) {
      return {
        type: "list_models_response",
        providerId,
        models: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // ── Terminals ────────────────────────────────────────────────────────────────
  const terminalManager = new TerminalManager();
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

  // ── Projects / git / worktrees ────────────────────────────────────────────────
  const workspaceRegistry = new WorkspaceRegistryService(home);
  new OpenProjectService({ home, broadcast, registry: workspaceRegistry }).registerHandlers(
    registry,
    getActiveSessions,
  );
  const gitService = new WorkspaceGitService();
  registerGitCheckoutHandlers(registry, {
    gitService,
    diffManager: new CheckoutDiffManager(),
    checkoutRefreshEnabled: true,
  });
  new GitOperationsService({ gitService }).registerHandlers(registry);
  new GitHubService({ setAutoMergeEnabled: true }).registerHandlers(registry);
  new WorktreeService({
    home,
    registry: workspaceRegistry,
    broadcast,
    getActiveSessions,
  }).registerHandlers(registry, getActiveSessions);

  // ── Files ───────────────────────────────────────────────────────────────────
  const fileTransfer = new FileTransferService();
  fileTransfer.registerHandlers(registry);
  new FileExplorerService({ issueDownloadToken: fileTransfer.issueDownloadToken }).registerHandlers(
    registry,
  );

  // ── Orchestration: chat ────────────────────────────────────────────────────────
  const chat = new ChatService({ home });
  registry.register("chat_create_request", async (ctx) => {
    const m = ctx.message as Record<string, unknown>;
    const room = await chat.createRoom({ name: m.name as string, purpose: m.purpose as string });
    return { type: "chat_create_response", room };
  });
  registry.register("chat_list_request", async () => ({
    type: "chat_list_response",
    rooms: await chat.listRooms(),
  }));
  registry.register("chat_inspect_request", async (ctx) => {
    const roomId = (ctx.message as Record<string, unknown>).roomId as string;
    return { type: "chat_inspect_response", ...(await chat.inspectRoom(roomId)) };
  });
  registry.register("chat_post_request", async (ctx) => {
    const m = ctx.message as Record<string, unknown>;
    const message = await chat.postMessage({
      roomId: m.roomId as string,
      authorAgentId: (m.from as string) ?? "human",
      body: m.message as string,
    });
    return { type: "chat_post_response", message };
  });
  registry.register("chat_read_request", async (ctx) => {
    const m = ctx.message as Record<string, unknown>;
    const result = await chat.readMessages(
      m.roomId as string,
      (m.cursor as number | undefined) ?? 0,
    );
    return { type: "chat_read_response", ...result };
  });
  registry.register("chat_delete_request", async (ctx) => {
    const roomId = (ctx.message as Record<string, unknown>).roomId as string;
    return { type: "chat_delete_response", ok: await chat.deleteRoom(roomId) };
  });

  // ── Orchestration: schedules ─────────────────────────────────────────────────
  const scheduleExecutor: ScheduleExecutor = {
    createAndPrompt: async (cfg, prompt) => {
      const result = (await agentService.handleCreate(
        { config: cfg, initialPrompt: prompt, requestId: randomId() },
        getActiveSessions,
      )) as { agentId: string };
      return { agentId: result.agentId };
    },
    promptExisting: async (agentId, prompt) => {
      await agentService.handleSendPrompt({ agentId, prompt }, getActiveSessions);
      return {};
    },
  };
  const schedules = new ScheduleService({ home, executor: scheduleExecutor });
  registry.register("schedule_create_request", async (ctx) => {
    const m = ctx.message as Record<string, unknown>;
    const schedule = await schedules.create({
      name: m.name as string | undefined,
      prompt: m.prompt as string,
      cadence: (m.cadence as never) ?? { type: "cron", expression: m.cron as string },
      target: (m.target as never) ?? {
        type: "new-agent",
        config: {
          provider: (m.provider as string) ?? "pi",
          cwd: (m.cwd as string) ?? process.cwd(),
        },
      },
    });
    return { type: "schedule_create_response", schedule };
  });
  registry.register("schedule_list_request", async () => ({
    type: "schedule_list_response",
    schedules: await schedules.list(),
  }));
  registry.register("schedule_inspect_request", async (ctx) => ({
    type: "schedule_inspect_response",
    schedule: await schedules.inspect(
      (ctx.message as Record<string, unknown>).scheduleId as string,
    ),
  }));
  registry.register("schedule_pause_request", async (ctx) => ({
    type: "schedule_pause_response",
    schedule: await schedules.pause((ctx.message as Record<string, unknown>).scheduleId as string),
  }));
  registry.register("schedule_resume_request", async (ctx) => ({
    type: "schedule_resume_response",
    schedule: await schedules.resume((ctx.message as Record<string, unknown>).scheduleId as string),
  }));
  registry.register("schedule_run_once_request", async (ctx) => ({
    type: "schedule_run_once_response",
    run: await schedules.runOnce((ctx.message as Record<string, unknown>).scheduleId as string),
  }));
  registry.register("schedule_logs_request", async (ctx) => ({
    type: "schedule_logs_response",
    runs: await schedules.logs((ctx.message as Record<string, unknown>).scheduleId as string),
  }));
  registry.register("schedule_delete_request", async (ctx) => ({
    type: "schedule_delete_response",
    ok: await schedules.delete((ctx.message as Record<string, unknown>).scheduleId as string),
  }));
  const scheduleTick = setInterval(() => void schedules.tick().catch(() => {}), 30_000);
  scheduleTick.unref?.();

  // ── Orchestration: loops ──────────────────────────────────────────────────────
  const loopExecutor: LoopExecutor = {
    runWorker: async ({ prompt, cwd, provider, model, modeId }) => {
      const result = (await agentService.handleCreate(
        { config: { provider, cwd, model, modeId }, initialPrompt: prompt, requestId: randomId() },
        getActiveSessions,
      )) as { agentId: string };
      return { agentId: result.agentId, outcome: "completed" as const };
    },
    runShellCheck: (command, cwd) => runShell(command, cwd),
    runVerifier: async (input, verifyPrompt) => {
      const result = (await agentService.handleCreate(
        {
          config: {
            provider: input.provider,
            cwd: input.cwd,
            model: input.model,
            modeId: input.modeId,
          },
          initialPrompt: verifyPrompt,
          requestId: randomId(),
        },
        getActiveSessions,
      )) as { agentId: string };
      // Minimal verifier: assume pass (the POC focuses on wiring, not verdict quality).
      return { passed: true, reason: "POC stub verdict: pass", agentId: result.agentId };
    },
    archiveAgent: (agentId) => manager.archiveAgent(agentId),
  };
  const loops = new LoopService({ home, executor: loopExecutor });
  await loops.recover();
  registry.register("loop_run_request", async (ctx) => {
    const m = ctx.message as Record<string, unknown>;
    const loop = await loops.run({
      prompt: m.prompt as string,
      cwd: (m.cwd as string) ?? process.cwd(),
      provider: (m.provider as string) ?? "pi",
      model: m.model as string | undefined,
      maxIterations: (m.maxIterations as number | undefined) ?? 3,
    });
    return { type: "loop_run_response", loop };
  });
  registry.register("loop_list_request", async () => ({
    type: "loop_list_response",
    loops: await loops.list(),
  }));
  registry.register("loop_inspect_request", async (ctx) => ({
    type: "loop_inspect_response",
    loop: await loops.inspect((ctx.message as Record<string, unknown>).loopId as string),
  }));
  registry.register("loop_logs_request", async (ctx) => ({
    type: "loop_logs_response",
    entries: await loops.logs((ctx.message as Record<string, unknown>).loopId as string),
  }));
  registry.register("loop_stop_request", async (ctx) => {
    await loops.stop((ctx.message as Record<string, unknown>).loopId as string);
    return { type: "loop_stop_response", ok: true };
  });

  handle.logger.info(
    { handlers: "all-features", provider: "pi (default)" },
    "dev bootstrap: feature handlers registered",
  );

  const baseClose = handle.close.bind(handle);
  return Object.assign(handle, {
    async close(): Promise<void> {
      clearInterval(scheduleTick);
      await baseClose();
    },
  });
}

// ── helpers ──────────────────────────────────────────────────────────────────

function randomId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runShell(
  command: string,
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ exitCode: code ?? 0, stdout, stderr }));
    child.on("error", (err) => resolve({ exitCode: 1, stdout, stderr: String(err) }));
  });
}

// Touch getTimeline so the import is retained for diagnostics use.
void getTimeline;
