import type {
  AgentCloneResponse,
  AgentCompactResponse,
  AgentCycleModelResponse,
  AgentExportHtmlResponse,
  AgentForkMessagesResponse,
  AgentForkResponse,
  AgentLastAssistantTextResponse,
  AgentListCommandsResponse,
  AgentNewSessionResponse,
  AgentSessionStatsResponse,
  AgentSetModelResponse,
  AgentSetSessionNameResponse,
  AgentStreamEvent,
  AgentSwitchSessionResponse,
  CreateAgentRequest,
  ExtensionPacksListResponse,
  ExtensionPacksSetResponse,
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
 * `resume_agent`, `import_agent_session`, `fetch_agent_timeline_request`, and the sprint-037
 * slash-command RPCs: `agent_session_stats_request`, `agent_compact_request`,
 * `agent_new_session_request`, `agent_switch_session_request`, `agent_fork_request`,
 * `agent_fork_messages_request`, `agent_clone_request`, `agent_set_session_name_request`,
 * `agent_export_html_request`, `agent_set_model_request`, `agent_cycle_model_request`,
 * `agent_last_assistant_text_request`), plus command discovery `agent_list_commands_request`.
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
  /** Steer the LIVE turn — inject a message delivered after the current assistant turn's tool
   *  calls, before the next LLM call. Provider must support steering (Pi does). */
  steer(message: string, opts?: { clientMessageId?: string; images?: unknown[] }): Promise<unknown>;
  /** Queue a follow-up message delivered only after the agent fully stops. */
  followUp(
    message: string,
    opts?: { clientMessageId?: string; images?: unknown[] },
  ): Promise<unknown>;
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
  /** Archive (soft-delete) the agent — closes the runtime, keeps the record for resume. */
  archive(): Promise<unknown>;
  /** Permanently delete the agent's persisted record (hard delete — no trace, cannot resume). */
  delete(): Promise<unknown>;
  /** Subscribe to `agent_update` events scoped to this agent. */
  onUpdate(handler: PiStudioAgentUpdateHandler): () => void;

  // Slash-command operations (sprint-037): Pi built-ins with a real Pi RPC equivalent. Each
  // resolves to the RPC's `payload` (the daemon unwraps `{type, requestId, payload}` to just
  // `payload` for a correlated response — see DaemonClient.request's resolvePending contract).
  /** `/session` — read-only stats (tokens, cost, context-window usage). */
  sessionStats(): Promise<AgentSessionStatsResponse["payload"]>;
  /** `/compact` — manually compact conversation context. */
  compact(customInstructions?: string): Promise<AgentCompactResponse["payload"]>;
  /** `/new` — start a fresh session in place. */
  newSession(): Promise<AgentNewSessionResponse["payload"]>;
  /** `/resume` — load a different session file in place. */
  switchSession(sessionPath: string): Promise<AgentSwitchSessionResponse["payload"]>;
  /** `/fork` — create a new branch from a previous user message. */
  fork(entryId: string): Promise<AgentForkResponse["payload"]>;
  /** Fork picker — user messages available to fork from. */
  forkMessages(): Promise<AgentForkMessagesResponse["payload"]>;
  /** `/clone` — duplicate the active branch into a new session at the current position. */
  clone(): Promise<AgentCloneResponse["payload"]>;
  /** `/name` — set the session display name. */
  setSessionName(name: string): Promise<AgentSetSessionNameResponse["payload"]>;
  /** `/export` — export the session to an HTML file. */
  exportHtml(outputPath?: string): Promise<AgentExportHtmlResponse["payload"]>;
  /** `/model` (set) — switch to a specific provider model. */
  setModel(provider: string, modelId: string): Promise<AgentSetModelResponse["payload"]>;
  /** `/model` (cycle) — cycle to the next available model. */
  cycleModel(): Promise<AgentCycleModelResponse["payload"]>;
  /** `/copy` — the text content of the last assistant message. */
  lastAssistantText(): Promise<AgentLastAssistantTextResponse["payload"]>;

  // Command discovery (sprint-040): user/project-authored commands — extension commands,
  // prompt templates, and skills — surfaced from Pi's `get_commands`. Disjoint from the
  // built-in slash commands above.
  /** List the session's discoverable commands (extensions, prompt templates, skills). */
  listCommands(): Promise<AgentListCommandsResponse["payload"]>;
}

export interface PiStudioWorkspaceActions {
  readonly workspaceId: string;
  /** Subscribe to `workspace_update` events scoped to this workspace. */
  onUpdate(handler: PiStudioWorkspaceUpdateHandler): () => void;
}

export interface ProviderModel {
  id: string;
  label?: string;
  description?: string;
  /**
   * The model's own underlying LLM provider (e.g. `"anthropic"`) — REQUIRED by
   * `AgentHandle.setModel(provider, modelId)`'s `provider` argument. Distinct from the
   * `ListProviderModelsResponse.provider` field above, which is the pi-studio `AgentClient` id
   * (`"pi"`/`"mock"`) used only to pick which client answered this list.
   */
  provider?: string;
}

export interface ListProviderModelsResponse {
  type: "list_provider_models_response";
  requestId: string;
  provider: string;
  models: ProviderModel[];
}

export interface ResolveDefaultModelResponse {
  type: "resolve_default_model_response";
  requestId: string;
  provider: string;
  /** The model a brand-new session with no override would run on — settings' configured default,
   * else the provider's built-in default — or `undefined` if the provider can't resolve one
   * without spawning a session. Display-only: never itself sent back to the daemon as a pick. */
  model?: string;
  /** The resolved model's own underlying LLM provider (e.g. `"anthropic"`) — same distinction as
   * `ProviderModel.provider`, required to pin it via `config.modelProvider` if the draft
   * materializes without the user ever changing it. */
  modelProvider?: string;
}

export interface PiStudioProviderActions {
  /** List available providers. */
  listProviders(): Promise<unknown>;
  /** List models for a provider. */
  listModels(provider: string): Promise<ListProviderModelsResponse>;
  /** List modes for a provider. */
  listModes(provider: string): Promise<unknown>;
  /** Resolve the model a brand-new session would run on with no override — backs the
   * web-client's "preselect the default model on a new chat" before anything is spawned. */
  resolveDefaultModel(provider: string, cwd?: string): Promise<ResolveDefaultModelResponse>;
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

  listExtensionPacks(): Promise<ExtensionPacksListResponse> {
    return this.daemon.request<ExtensionPacksListResponse>("extension_packs_list_request", {});
  }

  /**
   * Change the selection and sync. Resolves only after the daemon's sync completes — pass a
   * generous opts.timeoutMs for a first-run install, which can exceed the client's default
   * rpcTimeoutMs.
   */
  setExtensionPacks(
    packs: string[],
    opts?: { timeoutMs?: number },
  ): Promise<ExtensionPacksSetResponse> {
    return this.daemon.request<ExtensionPacksSetResponse>(
      "extension_packs_set_request",
      { packs },
      opts?.timeoutMs,
    );
  }

  /**
   * Sync now without changing the selection (sends the request with no `packs` key at all — the
   * ungated manual-sync path).
   */
  syncExtensionPacks(opts?: { timeoutMs?: number }): Promise<ExtensionPacksSetResponse> {
    return this.daemon.request<ExtensionPacksSetResponse>(
      "extension_packs_set_request",
      {},
      opts?.timeoutMs,
    );
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

  steer(
    message: string,
    opts: { clientMessageId?: string; images?: unknown[] } = {},
  ): Promise<unknown> {
    return this.daemon.request("steer_agent_request", {
      agentId: this.agentId,
      message,
      clientMessageId: opts.clientMessageId,
      images: opts.images,
    });
  }

  followUp(
    message: string,
    opts: { clientMessageId?: string; images?: unknown[] } = {},
  ): Promise<unknown> {
    return this.daemon.request("follow_up_agent_request", {
      agentId: this.agentId,
      message,
      clientMessageId: opts.clientMessageId,
      images: opts.images,
    });
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

  delete(): Promise<unknown> {
    return this.daemon.request("delete_agent", { agentId: this.agentId });
  }

  onUpdate(handler: PiStudioAgentUpdateHandler): () => void {
    return this.daemon.onSessionMessage((msg) => {
      const m = msg as unknown as AgentUpdateMessage;
      if (m.type === "agent_update" && m.agentId === this.agentId) handler(m);
    });
  }

  // Slash-command operations (sprint-037).

  sessionStats(): Promise<AgentSessionStatsResponse["payload"]> {
    return this.daemon.request("agent_session_stats_request", { agentId: this.agentId });
  }

  compact(customInstructions?: string): Promise<AgentCompactResponse["payload"]> {
    return this.daemon.request("agent_compact_request", {
      agentId: this.agentId,
      customInstructions,
    });
  }

  newSession(): Promise<AgentNewSessionResponse["payload"]> {
    return this.daemon.request("agent_new_session_request", { agentId: this.agentId });
  }

  switchSession(sessionPath: string): Promise<AgentSwitchSessionResponse["payload"]> {
    return this.daemon.request("agent_switch_session_request", {
      agentId: this.agentId,
      sessionPath,
    });
  }

  fork(entryId: string): Promise<AgentForkResponse["payload"]> {
    return this.daemon.request("agent_fork_request", { agentId: this.agentId, entryId });
  }

  forkMessages(): Promise<AgentForkMessagesResponse["payload"]> {
    return this.daemon.request("agent_fork_messages_request", { agentId: this.agentId });
  }

  clone(): Promise<AgentCloneResponse["payload"]> {
    return this.daemon.request("agent_clone_request", { agentId: this.agentId });
  }

  setSessionName(name: string): Promise<AgentSetSessionNameResponse["payload"]> {
    return this.daemon.request("agent_set_session_name_request", {
      agentId: this.agentId,
      name,
    });
  }

  exportHtml(outputPath?: string): Promise<AgentExportHtmlResponse["payload"]> {
    return this.daemon.request("agent_export_html_request", {
      agentId: this.agentId,
      outputPath,
    });
  }

  setModel(provider: string, modelId: string): Promise<AgentSetModelResponse["payload"]> {
    return this.daemon.request("agent_set_model_request", {
      agentId: this.agentId,
      provider,
      modelId,
    });
  }

  cycleModel(): Promise<AgentCycleModelResponse["payload"]> {
    return this.daemon.request("agent_cycle_model_request", { agentId: this.agentId });
  }

  lastAssistantText(): Promise<AgentLastAssistantTextResponse["payload"]> {
    return this.daemon.request("agent_last_assistant_text_request", { agentId: this.agentId });
  }

  /** Command discovery (sprint-040) — Pi `get_commands` via the daemon. */
  listCommands(): Promise<AgentListCommandsResponse["payload"]> {
    return this.daemon.request("agent_list_commands_request", { agentId: this.agentId });
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
  listModels(provider: string): Promise<ListProviderModelsResponse> {
    return this.daemon.request<ListProviderModelsResponse>("list_provider_models", { provider });
  }
  listModes(provider: string): Promise<unknown> {
    return this.daemon.request("list_provider_modes", { provider });
  }
  resolveDefaultModel(provider: string, cwd?: string): Promise<ResolveDefaultModelResponse> {
    return this.daemon.request<ResolveDefaultModelResponse>("resolve_default_model", {
      provider,
      ...(cwd ? { cwd } : {}),
    });
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
