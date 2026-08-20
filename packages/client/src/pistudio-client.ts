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
  ProviderAuthInfo,
  ProviderAuthType,
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
/** Metadata carried alongside a live `agent_stream` event (daemon-owned, not provider-replayed). */
export interface AgentStreamEventMeta {
  /** ISO-8601 or epoch-millis timestamp the daemon stamped on this event's timeline row. */
  timestamp?: string | number;
  seq?: number;
}

export type PiStudioAgentStreamHandler = (
  event: AgentStreamEvent,
  meta: AgentStreamEventMeta,
) => void;

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

// ─── Provider auth (remote login flows) ─────────────────────────────────────────

/**
 * The five `provider_auth_*` request/response pairs have real protocol schemas (sprint-055), but the
 * per-flow progress push does **not** — it rides `sessionMessageBaseSchema`'s passthrough fallback,
 * the established convention for this family (see `swe/features/provider-auth-rpc.md`
 * § Registration style, and `checkout_status_update` / `file_changed` before it). So the push's
 * shape is narrowed here with a local interface + type guard, mirroring how `TimelineHandle`
 * narrows `agent_stream`.
 */
export interface ProviderAuthFlowEventPush {
  type: "provider_auth_flow_event";
  flowId: string;
  event: { kind: string } & Record<string, unknown>;
}

/** Narrows an inbound session message to the `provider_auth_flow_event` push. */
export function isProviderAuthFlowEvent(message: unknown): message is ProviderAuthFlowEventPush {
  const m = message as { type?: unknown; flowId?: unknown; event?: unknown } | null;
  if (!m || m.type !== "provider_auth_flow_event" || typeof m.flowId !== "string") return false;
  const event = m.event as { kind?: unknown } | null;
  return typeof event === "object" && event !== null && typeof event.kind === "string";
}

/** One question Pi's auth engine asks mid-flow. `promptKind` decides the input control; a `select`
 *  carries its own option list. Answering means resolving `ProviderAuthCallbacks.prompt`. */
export interface ProviderAuthPromptUi {
  promptId: string;
  promptKind: "text" | "secret" | "select" | "manual_code";
  message: string;
  placeholder?: string;
  options?: readonly { id: string; label: string; description?: string }[];
  /**
   * Aborts when this specific prompt is cancelled out of band — Pi races a `manual_code` prompt
   * against its own OAuth callback server, so the callback winning cancels the question while the
   * flow carries on. A view MUST drop the input when this fires (and keep the rest of the flow's
   * presentation): the promise it returned from `prompt` is discarded by the SDK, so nothing else
   * tells it the question is gone. Also aborts when the flow itself ends.
   */
  signal?: AbortSignal;
}

/**
 * The `notify()`-sourced events the daemon forwards verbatim. Carries no secret by construction —
 * a prompt *value* travels only in the `provider_auth_respond_request` payload, never in an event.
 * Unknown future kinds still reach `onEvent` (append-only wire rule), so a view must tolerate them.
 */
export type ProviderAuthNotifyEvent =
  | { kind: "info"; message: string; links?: readonly { url: string; label?: string }[] }
  | { kind: "auth_url"; url: string; instructions?: string }
  | {
      kind: "device_code";
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { kind: "progress"; message: string };

/**
 * Every event a login-flow view reduces over: the daemon's notify events plus the three the SDK
 * driver consumes itself (`prompt` is delivered through `callbacks.prompt`, `prompt_cancelled`
 * rejects that pending prompt, `done` settles `loginProvider`). A view re-dispatches those three
 * into its own reducer from the callback/promise boundary.
 */
export type ProviderAuthFlowUiEvent =
  | ProviderAuthNotifyEvent
  | ({ kind: "prompt" } & ProviderAuthPromptUi)
  | { kind: "prompt_cancelled"; promptId: string }
  | { kind: "done"; ok: boolean; error?: string };

export interface ProviderAuthCallbacks {
  /**
   * Ask the user for a value. Resolve with the answer; **reject to cancel the whole flow**.
   * The returned promise is also rejected by the SDK when the daemon cancels the prompt
   * out-of-band (an OAuth callback won the race) or the flow otherwise ends — a view should treat
   * a rejection as "stop showing this input", not as an error to report.
   */
  prompt(prompt: ProviderAuthPromptUi): Promise<string>;
  /** Presentation/progress events. Never carries a secret. */
  onEvent?(event: ProviderAuthNotifyEvent): void;
}

export interface ProviderAuthLoginOptions {
  /** Abort to cancel the flow server-side. The promise still settles from the terminal `done`. */
  signal?: AbortSignal;
}

/** How a login flow ended. `error` is a daemon-sanitized reason, never a credential. */
export interface ProviderAuthLoginResult {
  ok: boolean;
  error?: string;
}

/**
 * A domain failure reported *in a response payload* rather than as an `rpc_error`. This family
 * puts domain errors in payloads by design (`swe/features/provider-auth-rpc.md`), so a caller that
 * only catches `RpcError` would silently read an empty provider list as "nothing configured".
 */
export class ProviderAuthError extends Error {
  constructor(
    message: string,
    readonly operation: "list" | "logout",
  ) {
    super(message);
    this.name = "ProviderAuthError";
  }
}

/** Rejection used for a prompt the daemon cancelled out-of-band — distinguishes "the user refused"
 *  (cancel the flow) from "this question is moot now" (let the flow continue). */
class PromptCancelledError extends Error {
  constructor(readonly promptId: string) {
    super("prompt_cancelled");
    this.name = "PromptCancelledError";
  }
}

/** Live state of the one login flow a client may run at a time. */
interface ActiveProviderAuthFlow {
  /** `null` until the login response lands — events that arrive first are buffered, not dropped. */
  flowId: string | null;
  buffered: ProviderAuthFlowEventPush[];
  pendingPrompt: { promptId: string; reject: (error: Error) => void } | null;
  /** An abort that arrived before `flowId` was known; the cancel RPC is sent once it is. */
  cancelRequested: boolean;
  terminal: boolean;
  settle: (result: ProviderAuthLoginResult) => void;
  unsubscribe: (() => void) | null;
}

// ─── Facade implementation ──────────────────────────────────────────────────────

export class PiStudioClient {
  /** Exactly one login flow per client instance, per `swe/features/provider-auth-rpc.md`. */
  private activeProviderAuthFlow: ActiveProviderAuthFlow | null = null;

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

  // ─── Provider auth ──────────────────────────────────────────────────────────

  /** True iff the daemon advertised the `providerAuth` capability in `server_info.features`. */
  hasProviderAuthCapability(): boolean {
    return this.daemon.hasFeature("providerAuth");
  }

  /** Every provider's login capability + current state. */
  async listProviderAuth(): Promise<ProviderAuthInfo[]> {
    const payload = await this.daemon.request<{
      ok: boolean;
      providers: ProviderAuthInfo[];
      error?: string;
    }>("provider_auth_list_request", {});
    if (!payload.ok) {
      throw new ProviderAuthError(payload.error ?? "failed to list provider auth state", "list");
    }
    return payload.providers;
  }

  /** Clear a provider's stored credential. `stillConfigured` flags a surviving ambient one
   *  (e.g. an env var) — the provider may still show as configured after this resolves. */
  async logoutProvider(provider: string): Promise<{ stillConfigured?: boolean }> {
    const payload = await this.daemon.request<{
      ok: boolean;
      stillConfigured?: boolean;
      error?: string;
    }>("provider_auth_logout_request", { provider });
    if (!payload.ok) {
      throw new ProviderAuthError(payload.error ?? "failed to log out", "logout");
    }
    return { stillConfigured: payload.stillConfigured };
  }

  /**
   * Drive one remote provider login end to end. `callbacks` answers Pi's questions and observes
   * presentation events; the returned promise settles only once — from the flow's terminal `done`
   * event, an immediate login rejection, or a lost connection — never left hanging.
   *
   * Only one flow may run per client instance; a second concurrent call rejects locally without
   * sending a second `provider_auth_login_request`.
   */
  async loginProvider(
    provider: string,
    authType: ProviderAuthType,
    callbacks: ProviderAuthCallbacks,
    opts?: ProviderAuthLoginOptions,
  ): Promise<ProviderAuthLoginResult> {
    if (this.activeProviderAuthFlow) {
      throw new Error("a provider-auth login is already in progress for this client");
    }

    let settleResult!: (result: ProviderAuthLoginResult) => void;
    const resultPromise = new Promise<ProviderAuthLoginResult>((resolve) => {
      settleResult = resolve;
    });
    const flow: ActiveProviderAuthFlow = {
      flowId: null,
      buffered: [],
      pendingPrompt: null,
      cancelRequested: opts?.signal?.aborted ?? false,
      terminal: false,
      settle: settleResult,
      unsubscribe: null,
    };
    this.activeProviderAuthFlow = flow;

    // Subscribe BEFORE sending the login request: the daemon starts Pi's flow the moment it
    // handles the RPC, so a `prompt`/`auth_url` can legitimately arrive before this request's own
    // response does. Subscribing after the await would silently drop it and hang the dialog.
    const unsubMessages = this.daemon.onSessionMessage((message) => {
      if (isProviderAuthFlowEvent(message)) this.routeProviderAuthEvent(flow, message, callbacks);
    });
    const unsubState = this.daemon.onStateChange((state) => {
      if (state === "closed") {
        this.settleProviderAuthFlow(flow, { ok: false, error: "connection_lost" });
      }
    });
    let onAbort: (() => void) | null = null;
    if (opts?.signal) {
      const signal = opts.signal;
      onAbort = () => {
        flow.cancelRequested = true;
        if (flow.flowId && !flow.terminal) {
          this.daemon
            .request("provider_auth_cancel_request", { flowId: flow.flowId })
            .catch(() => {});
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });
      flow.unsubscribe = () => {
        unsubMessages();
        unsubState();
        signal.removeEventListener("abort", onAbort as () => void);
      };
    } else {
      flow.unsubscribe = () => {
        unsubMessages();
        unsubState();
      };
    }

    try {
      const response = await this.daemon.request<{
        ok: boolean;
        flowId?: string;
        error?: string;
      }>("provider_auth_login_request", { provider, authType });
      if (flow.terminal) return resultPromise;
      if (!response.ok || !response.flowId) {
        this.settleProviderAuthFlow(flow, { ok: false, error: response.error });
        return resultPromise;
      }
      flow.flowId = response.flowId;
      const buffered = flow.buffered;
      flow.buffered = [];
      for (const message of buffered) {
        if (message.flowId === flow.flowId) {
          this.dispatchProviderAuthEvent(flow, message.event, callbacks);
        }
      }
      if (flow.cancelRequested && !flow.terminal) {
        this.daemon
          .request("provider_auth_cancel_request", { flowId: flow.flowId })
          .catch(() => {});
      }
    } catch {
      if (!flow.terminal) {
        this.settleProviderAuthFlow(flow, { ok: false, error: "connection_lost" });
      }
    }

    return resultPromise;
  }

  /** Route one inbound flow-event push: buffer until `flowId` is known, drop stale/unknown flows,
   *  else dispatch by `kind`. */
  private routeProviderAuthEvent(
    flow: ActiveProviderAuthFlow,
    message: ProviderAuthFlowEventPush,
    callbacks: ProviderAuthCallbacks,
  ): void {
    if (flow.terminal) return;
    if (flow.flowId === null) {
      flow.buffered.push(message);
      return;
    }
    if (message.flowId !== flow.flowId) return;
    this.dispatchProviderAuthEvent(flow, message.event, callbacks);
  }

  private dispatchProviderAuthEvent(
    flow: ActiveProviderAuthFlow,
    event: { kind: string } & Record<string, unknown>,
    callbacks: ProviderAuthCallbacks,
  ): void {
    switch (event.kind) {
      case "done":
        this.settleProviderAuthFlow(flow, {
          ok: Boolean(event.ok),
          error: typeof event.error === "string" ? event.error : undefined,
        });
        return;
      case "prompt_cancelled": {
        const promptId = event.promptId as string;
        if (flow.pendingPrompt && flow.pendingPrompt.promptId === promptId) {
          flow.pendingPrompt.reject(new PromptCancelledError(promptId));
          flow.pendingPrompt = null;
        }
        return;
      }
      case "prompt":
        void this.handleProviderAuthPrompt(flow, event, callbacks);
        return;
      default:
        callbacks.onEvent?.(event as unknown as ProviderAuthNotifyEvent);
        return;
    }
  }

  /** Ask the caller for a value, racing its answer against an out-of-band `prompt_cancelled`
   *  (an OAuth callback can win first). Never lets an unanswered promise dangle: a caller refusal
   *  or a failed respond RPC cancels the whole flow. */
  private async handleProviderAuthPrompt(
    flow: ActiveProviderAuthFlow,
    event: Record<string, unknown>,
    callbacks: ProviderAuthCallbacks,
  ): Promise<void> {
    // Aborted when this prompt is cancelled out of band (or the flow ends). The view cannot learn
    // that any other way: `prompt_cancelled` is consumed here rather than forwarded to `onEvent`,
    // and the promise the view returned is simply discarded by the race below — so without this
    // signal a `manual_code` input stays on screen after the OAuth callback already won.
    const cancelledController = new AbortController();
    const prompt: ProviderAuthPromptUi = {
      promptId: event.promptId as string,
      promptKind: event.promptKind as ProviderAuthPromptUi["promptKind"],
      message: event.message as string,
      placeholder: event.placeholder as string | undefined,
      options: event.options as ProviderAuthPromptUi["options"],
      signal: cancelledController.signal,
    };

    let rejectCancelled!: (error: Error) => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectCancelled = reject;
    });
    cancelled.catch(() => {});
    flow.pendingPrompt = {
      promptId: prompt.promptId,
      reject: (error) => {
        cancelledController.abort();
        rejectCancelled(error);
      },
    };

    const answered = callbacks.prompt(prompt);
    answered.catch(() => {});

    try {
      const value = await Promise.race([answered, cancelled]);
      if (flow.terminal) return;
      flow.pendingPrompt = null;
      await this.daemon.request("provider_auth_respond_request", {
        flowId: flow.flowId,
        promptId: prompt.promptId,
        value,
      });
    } catch (err) {
      flow.pendingPrompt = null;
      if (flow.terminal || err instanceof PromptCancelledError) return;
      if (flow.flowId) {
        this.daemon
          .request("provider_auth_cancel_request", { flowId: flow.flowId })
          .catch(() => {});
      }
    }
  }

  /** The single place a flow ends. Idempotent — whichever path (a `done` event, a lost connection,
   *  an immediate login rejection) settles it first wins; releases every subscription exactly once. */
  private settleProviderAuthFlow(
    flow: ActiveProviderAuthFlow,
    result: ProviderAuthLoginResult,
  ): void {
    if (flow.terminal) return;
    flow.terminal = true;
    if (flow.pendingPrompt) {
      flow.pendingPrompt.reject(new Error("provider-auth: flow ended"));
      flow.pendingPrompt = null;
    }
    flow.unsubscribe?.();
    if (this.activeProviderAuthFlow === flow) this.activeProviderAuthFlow = null;
    flow.settle(result);
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
      const m = msg as unknown as {
        type?: string;
        agentId?: string;
        event?: AgentStreamEvent;
        timestamp?: string | number;
        seq?: number;
      };
      if (m.type === "agent_stream" && m.agentId === this.agentId && m.event) {
        handler(m.event, { timestamp: m.timestamp, seq: m.seq });
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
