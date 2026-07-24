import type { Session } from "../ws/session.js";
import type { HandlerRegistry } from "../ws/router.js";
import type { AgentManager } from "./agent-manager.js";

/**
 * Slash-command operations (sprint-037): Pi built-in commands that have a real Pi RPC equivalent
 * — /session, /compact, /new, /resume, /fork, /clone, /name, /export, /model, /copy — surfaced as
 * their own daemon RPCs. Delegates to the optional `AgentSession` methods added in
 * provider-contract.ts; each is implemented for the `pi` provider (providers/pi/agent.ts) and
 * absent by default elsewhere.
 *
 * Pi's own RPC contract is explicit that TUI-only built-ins (/settings, /hotkeys, etc.) have no
 * RPC equivalent and would not execute if sent via `prompt` — those are intentionally NOT
 * represented here or on the wire (see clean-room-scope/sprints/sprint-037-agent-slash-commands).
 */

export interface SlashCommandOpsDeps {
  manager: AgentManager;
  broadcast: (sessions: Iterable<Session>, message: unknown) => void;
}

/** Resolve the live session for `agentId`, or throw an error the router turns into `rpc_error`. */
function requireSession(manager: AgentManager, agentId: string) {
  const managed = manager.get(agentId);
  if (!managed) throw new Error(`unknown agent: ${agentId}`);
  if (!managed.session) throw new Error(`agent ${agentId} has no live session`);
  return managed.session;
}

/** Build a clear, consistent error for a provider that doesn't implement an optional method. */
function unsupported(agentId: string, op: string): Error {
  return new Error(`agent ${agentId}'s provider does not support '${op}'`);
}

export class SlashCommandOperationsService {
  constructor(private readonly deps: SlashCommandOpsDeps) {}

  registerHandlers(registry: HandlerRegistry, getActiveSessions: () => Iterable<Session>): void {
    registry.register("agent_session_stats_request", (ctx) =>
      this.handleSessionStats(ctx.message as Record<string, unknown>),
    );
    registry.register("agent_compact_request", (ctx) =>
      this.handleCompact(ctx.message as Record<string, unknown>, getActiveSessions),
    );
    registry.register("agent_new_session_request", (ctx) =>
      this.handleNewSession(ctx.message as Record<string, unknown>, getActiveSessions),
    );
    registry.register("agent_switch_session_request", (ctx) =>
      this.handleSwitchSession(ctx.message as Record<string, unknown>, getActiveSessions),
    );
    registry.register("agent_fork_request", (ctx) =>
      this.handleFork(ctx.message as Record<string, unknown>),
    );
    registry.register("agent_fork_messages_request", (ctx) =>
      this.handleForkMessages(ctx.message as Record<string, unknown>),
    );
    registry.register("agent_clone_request", (ctx) =>
      this.handleClone(ctx.message as Record<string, unknown>, getActiveSessions),
    );
    registry.register("agent_set_session_name_request", (ctx) =>
      this.handleSetSessionName(ctx.message as Record<string, unknown>, getActiveSessions),
    );
    registry.register("agent_export_html_request", (ctx) =>
      this.handleExportHtml(ctx.message as Record<string, unknown>),
    );
    registry.register("agent_set_model_request", (ctx) =>
      this.handleSetModel(ctx.message as Record<string, unknown>, getActiveSessions),
    );
    registry.register("agent_cycle_model_request", (ctx) =>
      this.handleCycleModel(ctx.message as Record<string, unknown>, getActiveSessions),
    );
    registry.register("agent_last_assistant_text_request", (ctx) =>
      this.handleLastAssistantText(ctx.message as Record<string, unknown>),
    );
  }

  private broadcastAgentUpdate(
    getSessions: () => Iterable<Session>,
    agentId: string,
    extra: Record<string, unknown> = {},
  ): void {
    this.deps.broadcast(getSessions(), { type: "agent_update", agentId, ...extra });
  }

  /** `/session` — read-only, no broadcast needed. `model` is filled in from the session's live
   * runtime info when the provider's own stats payload omits it (sprint-042: makes the periodic
   * stats poll a self-correcting source for the status bar's model segment, covering `/model`
   * cycle and cross-client changes that `agent_update` alone doesn't fully convey). */
  async handleSessionStats(msg: Record<string, unknown>): Promise<unknown> {
    const agentId = msg.agentId as string;
    const session = requireSession(this.deps.manager, agentId);
    if (!session.getSessionStats) throw unsupported(agentId, "get_session_stats");
    const stats = await session.getSessionStats();
    const payload =
      stats.model !== undefined ? stats : { ...stats, model: session.getRuntimeInfo().model };
    return { type: "agent_session_stats_response", payload };
  }

  /** `/compact` — context changed, broadcast. */
  async handleCompact(
    msg: Record<string, unknown>,
    getSessions: () => Iterable<Session>,
  ): Promise<unknown> {
    const agentId = msg.agentId as string;
    const session = requireSession(this.deps.manager, agentId);
    if (!session.compact) throw unsupported(agentId, "compact");
    const customInstructions =
      typeof msg.customInstructions === "string" ? msg.customInstructions : undefined;
    const payload = await session.compact(customInstructions);
    this.broadcastAgentUpdate(getSessions, agentId, { compacted: true });
    return { type: "agent_compact_response", payload };
  }

  /** `/new` — starts a fresh session in place; broadcast. */
  async handleNewSession(
    msg: Record<string, unknown>,
    getSessions: () => Iterable<Session>,
  ): Promise<unknown> {
    const agentId = msg.agentId as string;
    const session = requireSession(this.deps.manager, agentId);
    if (!session.newSession) throw unsupported(agentId, "new_session");
    const payload = await session.newSession();
    if (!payload.cancelled) this.broadcastAgentUpdate(getSessions, agentId, { status: "idle" });
    return { type: "agent_new_session_response", payload };
  }

  /** `/resume` — loads a different session file in place; broadcast. */
  async handleSwitchSession(
    msg: Record<string, unknown>,
    getSessions: () => Iterable<Session>,
  ): Promise<unknown> {
    const agentId = msg.agentId as string;
    const sessionPath = msg.sessionPath as string;
    if (!sessionPath) throw new Error("sessionPath is required");
    const session = requireSession(this.deps.manager, agentId);
    if (!session.switchSession) throw unsupported(agentId, "switch_session");
    const payload = await session.switchSession(sessionPath);
    if (!payload.cancelled) this.broadcastAgentUpdate(getSessions, agentId, { status: "idle" });
    return { type: "agent_switch_session_response", payload };
  }

  /** `/fork` — read side effect (new branch), no live-record broadcast needed here. */
  async handleFork(msg: Record<string, unknown>): Promise<unknown> {
    const agentId = msg.agentId as string;
    const entryId = msg.entryId as string;
    if (!entryId) throw new Error("entryId is required");
    const session = requireSession(this.deps.manager, agentId);
    if (!session.fork) throw unsupported(agentId, "fork");
    const payload = await session.fork(entryId);
    return { type: "agent_fork_response", payload };
  }

  /** Fork picker — read-only. */
  async handleForkMessages(msg: Record<string, unknown>): Promise<unknown> {
    const agentId = msg.agentId as string;
    const session = requireSession(this.deps.manager, agentId);
    if (!session.getForkMessages) throw unsupported(agentId, "get_fork_messages");
    const messages = await session.getForkMessages();
    return { type: "agent_fork_messages_response", payload: { messages } };
  }

  /** `/clone` — duplicates the active branch into a new session at the current position. */
  async handleClone(
    msg: Record<string, unknown>,
    getSessions: () => Iterable<Session>,
  ): Promise<unknown> {
    const agentId = msg.agentId as string;
    const session = requireSession(this.deps.manager, agentId);
    if (!session.clone) throw unsupported(agentId, "clone");
    const payload = await session.clone();
    if (!payload.cancelled) this.broadcastAgentUpdate(getSessions, agentId);
    return { type: "agent_clone_response", payload };
  }

  /** `/name` — sets the session display name; persist it to the record (single source of truth:
   * `AgentManager.updateRecord`) and broadcast the new title. */
  async handleSetSessionName(
    msg: Record<string, unknown>,
    getSessions: () => Iterable<Session>,
  ): Promise<unknown> {
    const agentId = msg.agentId as string;
    const name = msg.name as string;
    if (!name) throw new Error("name is required");
    const session = requireSession(this.deps.manager, agentId);
    if (!session.setSessionName) throw unsupported(agentId, "set_session_name");
    await session.setSessionName(name);
    await this.deps.manager.updateRecord(agentId, { title: name });
    this.broadcastAgentUpdate(getSessions, agentId, { title: name });
    return { type: "agent_set_session_name_response", payload: {} };
  }

  /** `/export` — read-only side effect (writes a file), no live-record broadcast needed. */
  async handleExportHtml(msg: Record<string, unknown>): Promise<unknown> {
    const agentId = msg.agentId as string;
    const outputPath = typeof msg.outputPath === "string" ? msg.outputPath : undefined;
    const session = requireSession(this.deps.manager, agentId);
    if (!session.exportHtml) throw unsupported(agentId, "export_html");
    const payload = await session.exportHtml(outputPath);
    return { type: "agent_export_html_response", payload };
  }

  /** Persist the resolved model, and its own underlying LLM `provider` (e.g. `"anthropic"` —
   * distinct from the pi-studio `AgentClient` id on `record.provider`), into the record's config
   * so `list_agents_request` can surface it after a daemon restart, a fresh connection, or a
   * pick on a still-unspawned deferred draft (`managed.session` is `null` in all three cases, so
   * `bootstrap.ts`/`dev-bootstrap.ts` fall back to `record.config`) — previously only `model` was
   * written here, which is why a restored session's model selector came back with no known
   * provider even though `/model` had been set earlier in the same session. */
  private async persistModel(
    agentId: string,
    modelId: string | undefined,
    modelProvider?: string,
  ): Promise<void> {
    if (!modelId) return;
    const config = {
      ...this.deps.manager.get(agentId)?.record.config,
      model: modelId,
      ...(modelProvider && { modelProvider }),
    };
    await this.deps.manager.updateRecord(agentId, { config });
  }

  /** `/model` (set) — broadcast the model change and persist it (see `persistModel`). A
   * materialized draft with no live process yet (`managed.session === null` — deferred-draft
   * creation, `agent-service.ts` `handleCreate`, defers the real spawn to first send) has no
   * live session to call `setProviderModel` on; picking a model there just pins it into the
   * persisted config directly, the same way the untouched preselected default gets pinned at
   * materialization time, for `spawnOrResumeSession` to replay on first spawn. Skipping this
   * branch (routing straight to `requireSession`, which throws `"has no live session"`) was a
   * real bug: the thrown RPC error is swallowed client-side (`ModelMenu`'s caller has no
   * dedicated UI surface for it), so the pick silently never reached disk — reverting to the
   * default on the next reconnect even though the picker showed the new model the whole time. */
  async handleSetModel(
    msg: Record<string, unknown>,
    getSessions: () => Iterable<Session>,
  ): Promise<unknown> {
    const agentId = msg.agentId as string;
    const provider = msg.provider as string;
    const modelId = msg.modelId as string;
    if (!provider || !modelId) throw new Error("provider and modelId are required");
    const managed = this.deps.manager.get(agentId);
    if (!managed) throw new Error(`unknown agent: ${agentId}`);
    if (!managed.session) {
      await this.persistModel(agentId, modelId, provider);
      this.broadcastAgentUpdate(getSessions, agentId, { model: modelId, modelProvider: provider });
      return { type: "agent_set_model_response", payload: { id: modelId, provider } };
    }
    if (!managed.session.setProviderModel) throw unsupported(agentId, "set_model");
    const payload = await managed.session.setProviderModel(provider, modelId);
    await this.persistModel(agentId, modelId, provider);
    this.broadcastAgentUpdate(getSessions, agentId, { model: modelId, modelProvider: provider });
    return { type: "agent_set_model_response", payload };
  }

  /** `/model` (cycle) — broadcast and persist the resulting model (see `persistModel`). Reads the
   * resolved id back off `getRuntimeInfo()` rather than the raw `cycleModel()` payload since the
   * provider (`providers/pi/agent.ts`) already normalizes it there via `modelIdFrom`. */
  async handleCycleModel(
    msg: Record<string, unknown>,
    getSessions: () => Iterable<Session>,
  ): Promise<unknown> {
    const agentId = msg.agentId as string;
    const session = requireSession(this.deps.manager, agentId);
    if (!session.cycleModel) throw unsupported(agentId, "cycle_model");
    const payload = await session.cycleModel();
    const modelId = session.getRuntimeInfo().model;
    await this.persistModel(agentId, modelId);
    this.broadcastAgentUpdate(getSessions, agentId, modelId ? { model: modelId } : {});
    return { type: "agent_cycle_model_response", payload };
  }

  /** `/copy` — read-only. */
  async handleLastAssistantText(msg: Record<string, unknown>): Promise<unknown> {
    const agentId = msg.agentId as string;
    const session = requireSession(this.deps.manager, agentId);
    if (!session.getLastAssistantText) throw unsupported(agentId, "get_last_assistant_text");
    const text = await session.getLastAssistantText();
    return { type: "agent_last_assistant_text_response", payload: { text } };
  }
}
