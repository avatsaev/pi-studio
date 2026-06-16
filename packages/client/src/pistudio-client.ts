import type {
  AgentStreamEvent,
  CreateAgentRequest,
  FetchAgentTimelineResponse,
  SessionMessage,
  TimelineDirection,
} from "@av-pi-studio/protocol";

import type { DaemonClient } from "./daemon-client.js";

/**
 * High-level `PiStudioClient` SDK facade over the low-level `DaemonClient` driver.
 *
 * Exposes workspace/agent/provider handles plus update handler registration, mirroring the
 * scope's `Pi-StudioClient` surface (architecture/client-app-runtime.md § Layered client library /
 * Facade and features/agent-sessions.md § Public Contract). Method names follow the server RPC
 * type names (`create_agent_request`, `send_agent_prompt`, `interrupt_agent`, `update_agent`,
 * `resume_agent`, `import_agent_session`, `fetch_agent_timeline_request`).
 *
 * Out of scope: app runtime controller (sprint-012), terminal router (task-003).
 */

// ─── Update handler types ─────────────────────────────────────────────────────

export type PiStudioAgentUpdateHandler = (update: AgentUpdateMessage) => void;
export type PiStudioWorkspaceUpdateHandler = (update: WorkspaceUpdateMessage) => void;
export type PiStudioAgentStreamHandler = (event: AgentStreamEvent) => void;

/** Shape of an inbound `agent_update` session message (append-only; passthrough). */
export interface AgentUpdateMessage {
  type: "agent_update";
  agentId: string;
  status?: string;
  title?: string;
  labels?: Record<string, string>;
  [key: string]: unknown;
}

/** Shape of an inbound `workspace_update` session message. */
export interface WorkspaceUpdateMessage {
  type: "workspace_update";
  workspaceId: string;
  [key: string]: unknown;
}

// ─── Agent / timeline / workspace / provider handle interfaces ──────────────────

export interface PiStudioAgentTimelineHandle {
  /** Fetch a bounded page of authoritative timeline history. */
  fetch(opts?: {
    cursor?: string;
    direction?: TimelineDirection;
    limit?: number;
  }): Promise<FetchAgentTimelineResponse>;
  /** Subscribe to live `agent_stream` events for this agent. Returns an unsubscribe fn. */
  subscribe(handler: PiStudioAgentStreamHandler): () => void;
}

export interface PiStudioAgentActions {
  readonly agentId: string;
  readonly timeline: PiStudioAgentTimelineHandle;
  /** Send a follow-up prompt to the running/idle agent. */
  send(prompt: string, opts?: { clientMessageId?: string; images?: unknown[] }): Promise<unknown>;
  /** Alias for `send` reflecting the scope's "run a turn" verb. */
  run(prompt: string, opts?: { clientMessageId?: string; images?: unknown[] }): Promise<unknown>;
  /** Interrupt the current turn. */
  interrupt(): Promise<unknown>;
  /** Update model/mode/thinking/features/title/labels without recreating the session. */
  update(patch: {
    modeId?: string;
    model?: string;
    thinkingOptionId?: string;
    featureValues?: Record<string, unknown>;
    title?: string;
    labels?: Record<string, string>;
  }): Promise<unknown>;
  /** Resume a closed session via its persistence handle. */
  resume(): Promise<unknown>;
  /** Archive (soft-delete) the agent. */
  archive(): Promise<unknown>;
  /** Subscribe to `agent_update` events scoped to this agent. */
  onUpdate(handler: PiStudioAgentUpdateHandler): () => void;
}

export interface PiStudioWorkspaceActions {
  readonly workspaceId: string;
  /** Subscribe to `workspace_update` events scoped to this workspace. */
  onUpdate(handler: PiStudioWorkspaceUpdateHandler): () => void;
}

export interface PiStudioProviderActions {
  /** List available providers. */
  listProviders(): Promise<unknown>;
  /** List models for a provider. */
  listModels(provider: string): Promise<unknown>;
  /** List modes for a provider. */
  listModes(provider: string): Promise<unknown>;
  /** Trigger an explicit provider snapshot refresh (no hidden revalidation). */
  refreshSnapshot(): Promise<unknown>;
}

// ─── Facade implementation ──────────────────────────────────────────────────────

export class PiStudioClient {
  constructor(private readonly daemon: DaemonClient) {}

  get connection(): DaemonClient {
    return this.daemon;
  }

  /**
   * Create a new agent session. Returns the response payload (includes `agentId`). When
   * `initialPrompt` is set, the daemon runs the first turn and streams events to subscribers.
   */
  async createAgent(
    req: Omit<CreateAgentRequest, "type" | "requestId"> & { requestId?: string },
  ): Promise<{ agentId: string; [key: string]: unknown }> {
    const payload = await this.daemon.request<{ agentId: string }>("create_agent_request", {
      ...req,
    });
    return payload as { agentId: string };
  }

  /** Get an agent handle for an existing agentId. */
  agent(agentId: string): PiStudioAgentActions {
    return new AgentHandle(this.daemon, agentId);
  }

  /** Get a workspace handle for an existing workspaceId. */
  workspace(workspaceId: string): PiStudioWorkspaceActions {
    return new WorkspaceHandle(this.daemon, workspaceId);
  }

  /** Provider actions (list providers/models/modes, refresh snapshot). */
  get providers(): PiStudioProviderActions {
    return new ProviderHandle(this.daemon);
  }

  /** Subscribe to ALL `agent_update` events (any agent). */
  onAgentUpdate(handler: PiStudioAgentUpdateHandler): () => void {
    return this.daemon.onSessionMessage((msg) => {
      if ((msg as { type?: string }).type === "agent_update") {
        handler(msg as unknown as AgentUpdateMessage);
      }
    });
  }

  /** Subscribe to ALL `workspace_update` events (any workspace). */
  onWorkspaceUpdate(handler: PiStudioWorkspaceUpdateHandler): () => void {
    return this.daemon.onSessionMessage((msg) => {
      if ((msg as { type?: string }).type === "workspace_update") {
        handler(msg as unknown as WorkspaceUpdateMessage);
      }
    });
  }
}

// ─── Handle classes ──────────────────────────────────────────────────────────────

class TimelineHandle implements PiStudioAgentTimelineHandle {
  constructor(
    private readonly daemon: DaemonClient,
    private readonly agentId: string,
  ) {}

  fetch(
    opts: { cursor?: string; direction?: TimelineDirection; limit?: number } = {},
  ): Promise<FetchAgentTimelineResponse> {
    return this.daemon.request<FetchAgentTimelineResponse>("fetch_agent_timeline_request", {
      agentId: this.agentId,
      cursor: opts.cursor,
      direction: opts.direction,
      limit: opts.limit,
    });
  }

  subscribe(handler: PiStudioAgentStreamHandler): () => void {
    return this.daemon.onSessionMessage((msg) => {
      const m = msg as unknown as { type?: string; agentId?: string; event?: AgentStreamEvent };
      if (m.type === "agent_stream" && m.agentId === this.agentId && m.event) {
        handler(m.event);
      }
    });
  }
}

class AgentHandle implements PiStudioAgentActions {
  readonly timeline: PiStudioAgentTimelineHandle;

  constructor(
    private readonly daemon: DaemonClient,
    readonly agentId: string,
  ) {
    this.timeline = new TimelineHandle(daemon, agentId);
  }

  send(
    prompt: string,
    opts: { clientMessageId?: string; images?: unknown[] } = {},
  ): Promise<unknown> {
    return this.daemon.request("send_agent_prompt", {
      agentId: this.agentId,
      prompt,
      clientMessageId: opts.clientMessageId,
      images: opts.images,
    });
  }

  run(prompt: string, opts?: { clientMessageId?: string; images?: unknown[] }): Promise<unknown> {
    return this.send(prompt, opts);
  }

  interrupt(): Promise<unknown> {
    return this.daemon.request("interrupt_agent", { agentId: this.agentId });
  }

  update(patch: {
    modeId?: string;
    model?: string;
    thinkingOptionId?: string;
    featureValues?: Record<string, unknown>;
    title?: string;
    labels?: Record<string, string>;
  }): Promise<unknown> {
    return this.daemon.request("update_agent", { agentId: this.agentId, ...patch });
  }

  resume(): Promise<unknown> {
    return this.daemon.request("resume_agent", { agentId: this.agentId });
  }

  archive(): Promise<unknown> {
    return this.daemon.request("archive_agent", { agentId: this.agentId });
  }

  onUpdate(handler: PiStudioAgentUpdateHandler): () => void {
    return this.daemon.onSessionMessage((msg) => {
      const m = msg as unknown as AgentUpdateMessage;
      if (m.type === "agent_update" && m.agentId === this.agentId) handler(m);
    });
  }
}

class WorkspaceHandle implements PiStudioWorkspaceActions {
  constructor(
    private readonly daemon: DaemonClient,
    readonly workspaceId: string,
  ) {}

  onUpdate(handler: PiStudioWorkspaceUpdateHandler): () => void {
    return this.daemon.onSessionMessage((msg) => {
      const m = msg as unknown as WorkspaceUpdateMessage;
      if (m.type === "workspace_update" && m.workspaceId === this.workspaceId) handler(m);
    });
  }
}

class ProviderHandle implements PiStudioProviderActions {
  constructor(private readonly daemon: DaemonClient) {}

  listProviders(): Promise<unknown> {
    return this.daemon.request("list_providers", {});
  }
  listModels(provider: string): Promise<unknown> {
    return this.daemon.request("list_provider_models", { provider });
  }
  listModes(provider: string): Promise<unknown> {
    return this.daemon.request("list_provider_modes", { provider });
  }
  refreshSnapshot(): Promise<unknown> {
    // Dotted-namespace RPC per the protocol convention.
    return this.daemon.request("providers.snapshot.refresh.request", {});
  }
}

/** Convenience re-export of the import operation (not agent-scoped). */
export function importAgentSession(
  daemon: DaemonClient,
  args: { provider: string; cwd: string; providerHandleId: string },
): Promise<unknown> {
  return daemon.request("import_agent_session", args);
}

export type { SessionMessage };
