import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import type { AgentUiPendingRequest, AgentUiResponse } from "@av-pi-studio/protocol";

import { PARENT_AGENT_ID_LABEL } from "./agent-manager.js";

/**
 * Daemon MCP tool registry (features/mcp-server.md). Defines the orchestration tools that are
 * *intended* to be hosted at `/mcp/agents` so agents can control other agents + the daemon, and
 * mirrors the WS/CLI control plane. Owns the tool registry, `create_agent` semantics, and
 * injection-config generation, all injectable for tests.
 *
 * NOT REACHABLE AT RUNTIME. Nothing in this repo constructs an `McpServer` outside
 * `mcp-server.test.ts`. Specifically missing:
 *   - no HTTP route serving `MCP_ENDPOINT_PATH` in either bootstrap;
 *   - no `McpBackend` implementation anywhere in production code;
 *   - no `daemon.mcp` config section (`enabled`/`injectIntoAgents` are read from deps only);
 *   - `buildPiArgs` accepts `mcpConfigPath`, but all three Pi spawn sites pass only
 *     `appendSystemPrompt`, so no agent is ever handed a `--mcp-config`.
 * Sprint-010/task-001 built this registry and deferred the transport as "a bootstrap step"; that
 * step was never taken. Consequence: every tool here is dormant — including
 * `list_pending_permissions`/`respond_to_permission` (sprint-010) and
 * `list_pending_ui_requests`/`respond_to_ui_request` (sprint-066/task-005) — and the
 * agent-to-agent orchestration in `features/subagents.md` has never run.
 *
 * Two things a future wiring task must handle, neither of which is a simple hookup:
 *   1. `callTool()` is a plain dispatcher, NOT an MCP protocol implementation. A real endpoint
 *      needs JSON-RPC plus the `initialize`/`tools/list`/`tools/call` handshake over streamable
 *      HTTP or SSE. That layer does not exist here.
 *   2. `injectionConfig()` hardcodes `auth: false, oauth: false`, but the daemon's HTTP server is
 *      built with `authenticate: (req) => auth.authenticateHttp(req)` (bootstrap.ts) and production
 *      binds `0.0.0.0:6767` by default. Serving these tools unauthenticated would expose
 *      `create_agent`/`kill_agent`/`send_agent_prompt` to the network. Bind the route to loopback
 *      or carry a token in the injected config — the two existing code paths contradict each other
 *      today only because neither runs.
 */

export const MCP_ENDPOINT_PATH = "/mcp/agents";
export const MCP_SERVER_KEY = "pi-studio-agents";

export interface McpToolResult {
  ok: boolean;
  [key: string]: unknown;
}

export interface McpToolContext {
  /** The agent invoking the tool (the "parent"), when the call originates inside an agent. */
  callerAgentId?: string;
}

export type McpToolHandler<A> = (
  args: A,
  ctx: McpToolContext,
) => Promise<McpToolResult> | McpToolResult;

interface RegisteredTool {
  schema: z.ZodTypeAny;
  handler: McpToolHandler<unknown>;
}

/** Backend the orchestration tools route to (AgentManager / permission / provider services). */
export interface McpBackend {
  /** Create an async child agent. Returns its id. */
  createAgent(input: {
    config: Record<string, unknown>;
    labels: Record<string, string>;
    initialPrompt?: string;
    notifyOnFinish: boolean;
    autoArchive?: boolean;
  }): Promise<{ agentId: string }>;
  updateAgent?(agentId: string, patch: Record<string, unknown>): Promise<void>;
  sendPrompt(agentId: string, prompt: string): Promise<void>;
  getStatus(agentId: string): { status: string; title?: string } | undefined;
  getActivity?(agentId: string): unknown;
  listAgents(): Array<{ agentId: string; status: string; title?: string }>;
  setMode?(agentId: string, modeId: string): Promise<void>;
  /** Resolve when the agent reaches a terminal turn; resolve early/late is the backend's concern. */
  waitForAgent(agentId: string, timeoutMs: number): Promise<{ status: string; timedOut: boolean }>;
  cancelAgent?(agentId: string): Promise<void>;
  killAgent?(agentId: string): Promise<void>;
  archiveAgent(agentId: string): Promise<void>;
  listPendingPermissions(
    agentId?: string,
  ): Array<{ requestId: string; agentId: string; toolName?: string }>;
  respondToPermission(requestId: string, response: unknown): { resolved: boolean };
  /** Extension UI (features/extension-ui-rpc.md § MCP mirror) — closes the deadlock where an
   *  orchestrating agent can't answer a child's extension questionnaire. Mirrors the permission
   *  pair's shape; its own error vocabulary ("unknown_ui_request"/"unsupported") is intentionally
   *  distinct — see the tool registration below for why. */
  listPendingUiRequests(agentId?: string): AgentUiPendingRequest[];
  respondToUiRequest(
    requestId: string,
    response: AgentUiResponse,
  ): { resolved: boolean; error?: string };
  listProviders(): unknown;
  inspectProvider?(providerId: string): unknown;
  listModels(providerId: string): unknown;
}

export interface McpServerDeps {
  backend: McpBackend;
  /** Whether the MCP server is enabled (`daemon.mcp.enabled`/present). */
  enabled: boolean;
  /** Whether to inject the server into agents (`daemon.mcp.injectIntoAgents`). */
  injectIntoAgents: boolean;
  /** Daemon home; per-agent mcp configs live under `<home>/mcp/`. */
  home: string;
  /** Base URL of the local endpoint (host:port). */
  baseUrl?: string;
  defaultWaitTimeoutMs?: number;
}

export class McpServer {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly defaultWaitTimeoutMs: number;

  constructor(private readonly deps: McpServerDeps) {
    this.defaultWaitTimeoutMs = deps.defaultWaitTimeoutMs ?? 5 * 60_000;
    if (deps.enabled) this.registerCoreTools();
  }

  get enabled(): boolean {
    return this.deps.enabled;
  }

  /** Tool names currently exposed (empty when disabled). */
  toolNames(): string[] {
    return [...this.tools.keys()].toSorted();
  }

  /** Register an extension tool (schedule/chat/loop/terminal/worktree tasks attach theirs here). */
  registerTool<A>(name: string, schema: z.ZodType<A>, handler: McpToolHandler<A>): void {
    if (!this.deps.enabled) return;
    this.tools.set(name, { schema, handler: handler as McpToolHandler<unknown> });
  }

  /** Validate args + dispatch a tool call. */
  async callTool(name: string, rawArgs: unknown, ctx: McpToolContext = {}): Promise<McpToolResult> {
    if (!this.deps.enabled) return { ok: false, error: "mcp_disabled" };
    const tool = this.tools.get(name);
    if (!tool) return { ok: false, error: `unknown_tool:${name}` };
    const parsed = tool.schema.safeParse(rawArgs ?? {});
    if (!parsed.success) return { ok: false, error: "invalid_args", issues: parsed.error.issues };
    return tool.handler(parsed.data, ctx);
  }

  // ─── Injection ─────────────────────────────────────────────────────────────

  /** The `--mcp-config` object injected into Pi for a per-agent local server (OAuth disabled). */
  injectionConfig(): Record<string, unknown> | null {
    if (!this.deps.enabled || !this.deps.injectIntoAgents) return null;
    const url = `${this.deps.baseUrl ?? "http://127.0.0.1:0"}${MCP_ENDPOINT_PATH}`;
    return {
      mcpServers: {
        [MCP_SERVER_KEY]: { type: "http", url, auth: false, oauth: false },
      },
    };
  }

  /**
   * Write a per-agent `--mcp-config` under `<home>/mcp/agent-<id>.json` (never user/project files).
   * Returns the path, or null when injection is disabled.
   */
  async writeInjectionConfig(agentId: string): Promise<string | null> {
    const config = this.injectionConfig();
    if (!config) return null;
    const dir = join(this.deps.home, "mcp");
    await mkdir(dir, { recursive: true });
    const path = join(dir, `agent-${agentId}.json`);
    await writeFile(path, JSON.stringify(config, null, 2));
    return path;
  }

  // ─── Core tools ──────────────────────────────────────────────────────────────

  private registerCoreTools(): void {
    const b = this.deps.backend;

    // create_agent — always async (agent-scoped); parent label unless detached; notifyOnFinish=true.
    this.registerTool(
      "create_agent",
      z.object({
        config: z.record(z.unknown()).default({}),
        prompt: z.string().optional(),
        detached: z.boolean().optional(),
        notifyOnFinish: z.boolean().optional(),
        autoArchive: z.boolean().optional(),
        labels: z.record(z.string()).optional(),
      }),
      async (args, ctx) => {
        const labels: Record<string, string> = { ...args.labels };
        if (!args.detached && ctx.callerAgentId) {
          labels[PARENT_AGENT_ID_LABEL] = ctx.callerAgentId;
        }
        const { agentId } = await b.createAgent({
          config: args.config ?? {},
          labels,
          initialPrompt: args.prompt,
          notifyOnFinish: args.notifyOnFinish ?? true,
          autoArchive: args.autoArchive,
        });
        return { ok: true, agentId, detached: Boolean(args.detached) };
      },
    );

    this.registerTool(
      "wait_for_agent",
      z.object({ agentId: z.string(), timeoutMs: z.number().int().positive().optional() }),
      async (args) => {
        const result = await b.waitForAgent(
          args.agentId,
          args.timeoutMs ?? this.defaultWaitTimeoutMs,
        );
        return { ok: true, ...result };
      },
    );

    this.registerTool(
      "send_agent_prompt",
      z.object({ agentId: z.string(), prompt: z.string() }),
      async (args) => {
        await b.sendPrompt(args.agentId, args.prompt);
        return { ok: true };
      },
    );

    this.registerTool("get_agent_status", z.object({ agentId: z.string() }), (args) => {
      const status = b.getStatus(args.agentId);
      return status ? { ok: true, ...status } : { ok: false, error: "unknown_agent" };
    });

    this.registerTool("get_agent_activity", z.object({ agentId: z.string() }), (args) => ({
      ok: true,
      activity: b.getActivity?.(args.agentId) ?? null,
    }));

    this.registerTool("list_agents", z.object({}).passthrough(), () => ({
      ok: true,
      agents: b.listAgents(),
    }));

    this.registerTool(
      "update_agent",
      z.object({ agentId: z.string(), patch: z.record(z.unknown()).default({}) }),
      async (args) => {
        await b.updateAgent?.(args.agentId, args.patch ?? {});
        return { ok: true };
      },
    );

    this.registerTool(
      "set_agent_mode",
      z.object({ agentId: z.string(), modeId: z.string() }),
      async (args) => {
        await b.setMode?.(args.agentId, args.modeId);
        return { ok: true };
      },
    );

    this.registerTool("cancel_agent", z.object({ agentId: z.string() }), async (args) => {
      await b.cancelAgent?.(args.agentId);
      return { ok: true };
    });

    this.registerTool("kill_agent", z.object({ agentId: z.string() }), async (args) => {
      await b.killAgent?.(args.agentId);
      return { ok: true };
    });

    this.registerTool("archive_agent", z.object({ agentId: z.string() }), async (args) => {
      await b.archiveAgent(args.agentId);
      return { ok: true };
    });

    // Permissions.
    this.registerTool(
      "list_pending_permissions",
      z.object({ agentId: z.string().optional() }),
      (args) => ({ ok: true, permissions: b.listPendingPermissions(args.agentId) }),
    );

    this.registerTool(
      "respond_to_permission",
      z.object({ requestId: z.string(), response: z.unknown() }),
      (args) => {
        const result = b.respondToPermission(args.requestId, args.response);
        return result.resolved ? { ok: true } : { ok: false, error: "unknown_permission" };
      },
    );

    // Extension UI (features/extension-ui-rpc.md § MCP mirror). Error vocabulary intentionally
    // differs from `respond_to_permission`'s `unknown_permission`/the WS side's `not_found`: a
    // `resolved:false` with no `error` (never happens for this backend) and an `unsupported`
    // result are distinct outcomes a caller must not conflate with "unknown" — collapsing a live
    // dialog on a provider without `respondToUi` into `unknown_ui_request` would report it as
    // gone when it is actually still answerable over WS by a human.
    this.registerTool(
      "list_pending_ui_requests",
      z.object({ agentId: z.string().optional() }),
      (args) => ({ ok: true, requests: b.listPendingUiRequests(args.agentId) }),
    );

    this.registerTool(
      "respond_to_ui_request",
      z.object({ requestId: z.string(), response: z.unknown() }),
      (args) => {
        const result = b.respondToUiRequest(args.requestId, args.response as AgentUiResponse);
        if (result.resolved) return { ok: true };
        return {
          ok: false,
          error: result.error === "unsupported" ? "unsupported" : "unknown_ui_request",
        };
      },
    );

    // Providers / models.
    this.registerTool("list_providers", z.object({}).passthrough(), () => ({
      ok: true,
      providers: b.listProviders(),
    }));
    this.registerTool("inspect_provider", z.object({ providerId: z.string() }), (args) => ({
      ok: true,
      provider: b.inspectProvider?.(args.providerId) ?? null,
    }));
    this.registerTool("list_models", z.object({ providerId: z.string() }), (args) => ({
      ok: true,
      models: b.listModels(args.providerId),
    }));
  }
}
