import { randomUUID } from "node:crypto";

import type { AgentStreamEvent, ImageAttachment } from "@av-pi-studio/protocol";

import type { AgentRecord } from "../persistence/entity-schemas.js";
import type { Logger } from "../logging/logger.js";
import { agentStreamRecipients, type Session } from "../ws/session.js";
import type { HandlerRegistry } from "../ws/router.js";
import { AgentManager } from "./agent-manager.js";
import type {
  AgentClient,
  AgentSession,
  PersistenceHandle,
  RunOptions,
} from "./provider-contract.js";
import type { AgentTimelineStore } from "./timeline-store.js";
import { composeSystemPrompt } from "./compose-system-prompt.js";
import type { AgentTitleGenerator } from "./structured-generation-runtime.js";

/**
 * AgentService wires `create_agent_request` + run/turn loop + `agent_stream` broadcast
 * (features/agent-sessions.md § Create / § Behavior, architecture/websocket-protocol.md).
 */

export interface AgentServiceDeps {
  manager: AgentManager;
  resolveClient: (provider: string) => AgentClient;
  broadcast: (sessions: Iterable<Session>, message: unknown) => void;
  now?: () => string;
  /** Operational logger: agent created (info), turn started/finished (info), failures (error). */
  logger?: Logger;
  /** Daemon-side agent title generation (`structured-generation-runtime.ts`'s
   *  `createAgentTitleGenerator`). Absent -> auto-titling is off entirely (no bootstrap wires it,
   *  e.g. a minimal test harness); every production/dev bootstrap wires one. */
  generateAgentTitle?: AgentTitleGenerator;
}

/** Agent ids with an in-flight `generateAgentTitle` call — prevents two overlapping prompts on
 *  the same still-untitled agent from firing two concurrent generations. */
const titleGenerationInFlight = new Set<string>();

/** Whether `agentId` is a live agent that may gain history: present, and not archived. */
function acceptsHistory(manager: AgentManager, agentId: string): boolean {
  const record = manager.get(agentId)?.record;
  return record !== undefined && !record.archivedAt;
}

/**
 * Record `event` on `timeline` (`agentId`'s store, from `timelineFor`) and broadcast it as an
 * `agent_stream` frame carrying the daemon-owned seq/timestamp. The one append-and-broadcast path
 * for stream events: `runTurn`'s subscription and any operation that subscribes outside a turn
 * (today: compaction) both use it. Taking the store rather than looking it up means no caller can
 * append to an unseeded one.
 *
 * Two kinds are EPHEMERAL (live-stream-only, see timeline-streaming.md § Timeline model): a partial
 * `tool_call` (a superseded in-flight output snapshot) and `queue_update` (a snapshot of the
 * pending steer/follow-up queues). They are broadcast with a daemon-owned `timestamp` but NO `seq`,
 * and are never appended to the timeline, so they never appear in fetched history.
 */
export function appendStreamEvent(
  agentId: string,
  timeline: AgentTimelineStore,
  event: AgentStreamEvent,
  broadcast: (sessions: Iterable<Session>, message: unknown) => void,
  sessions: Iterable<Session>,
): void {
  if ((event.kind === "tool_call" && event.partial) || event.kind === "queue_update") {
    broadcast(agentStreamRecipients(sessions), {
      type: "session",
      message: { type: "agent_stream", agentId, timestamp: new Date().toISOString(), event },
    });
    return;
  }
  const row = timeline.append(event);
  broadcast(agentStreamRecipients(sessions), {
    type: "session",
    message: {
      type: "agent_stream",
      agentId,
      seq: row.seq,
      timestamp: row.timestamp,
      event,
    },
  });
}

/**
 * Seed `agentId`'s in-memory timeline from its provider's durable history when it has none yet (a
 * restarted daemon never has one). No-op when a store exists, or when the record has no persisted
 * handle / the provider has nothing to replay. Prefer `timelineFor` for anything that appends:
 * the first append would otherwise create an empty store, and `TimelineRegistry.seed` never
 * overwrites an existing one, so history would never hydrate.
 */
export function ensureTimelineSeeded(
  agentId: string,
  manager: AgentManager,
  resolveClient: (provider: string) => AgentClient,
  now?: () => string,
): void {
  if (manager.timelines.get(agentId)) return;
  const record = manager.get(agentId)?.record;
  const handle = record?.persistence as PersistenceHandle | undefined;
  if (!record || !handle) return;
  const rows = resolveClient(record.provider).hydrateTimeline?.(handle) ?? [];
  if (rows.length > 0) manager.timelines.seed(agentId, rows, now);
}

/**
 * The one way to get a timeline store to append to: seeds it from the provider's durable history
 * first (`ensureTimelineSeeded`), then returns the existing or a fresh store. `runTurn` and
 * compaction append through it, so whichever of send, compact or fetch comes first after a
 * restart, earlier history is already in the store.
 *
 * Refuses an agent that is gone or archived: the registry never regains a store an archive or
 * delete evicted (`AgentManager.timelines`), so an operation that races one cannot bring it back.
 */
export function timelineFor(
  deps: {
    manager: AgentManager;
    resolveClient: (provider: string) => AgentClient;
    now?: () => string;
  },
  agentId: string,
): AgentTimelineStore {
  if (!acceptsHistory(deps.manager, agentId)) {
    throw new Error(`agent ${agentId} is gone or archived`);
  }
  ensureTimelineSeeded(agentId, deps.manager, deps.resolveClient, deps.now);
  return deps.manager.timelines.getOrCreate(agentId, deps.now);
}

/**
 * Ensure `agentId` has a live provider session: the attached one, or a fresh one from
 * `spawnOrResumeSession`. The one entry point for every caller that needs a process but did not
 * start one itself (send, list commands, fork, clone, compact).
 */
export function ensureSession(
  deps: {
    manager: AgentManager;
    resolveClient: (provider: string) => AgentClient;
    logger?: Logger;
  },
  agentId: string,
): Promise<AgentSession> {
  const managed = deps.manager.get(agentId);
  if (!managed) return Promise.reject(new Error(`unknown agent: ${agentId}`));
  return managed.session ? Promise.resolve(managed.session) : spawnOrResumeSession(deps, agentId);
}

/**
 * Spawn `agentId`'s provider session: resume from a persisted handle, or — for a deferred draft
 * that was never spawned (`record.persistence` absent; see `AgentService.handleCreate` step 2) —
 * spawn it for the first time. Either way, replay the record's pinned model
 * (`config.model`/`config.modelProvider`, written when a draft materializes — see
 * `slash-command-operations.ts` `persistModel` and the web-client's `ensureMaterialized`) via
 * `setProviderModel`, since neither `createSession` nor `resumeSession` consult
 * `AgentSessionConfig.model` — Pi resolves its own default at spawn regardless
 * (`providers/pi/agent.ts` `discoverState`'s doc comment). Attaches the session and persists its
 * handle either way. Always spawns/resumes fresh — callers that want "reuse the live session if
 * there is one" use `ensureSession` (`SessionOperationsService.handleResume` intentionally always
 * forces a fresh process, and `AgentManager.attachSession` closes the one it replaces).
 *
 * One spawn per agent at a time (`AgentManager.spawnOnce`): a caller that arrives while one is in
 * flight gets that spawn's session. A failure after the process started closes it.
 */
export function spawnOrResumeSession(
  deps: {
    manager: AgentManager;
    resolveClient: (provider: string) => AgentClient;
    logger?: Logger;
  },
  agentId: string,
): Promise<AgentSession> {
  if (!deps.manager.get(agentId)) return Promise.reject(new Error(`unknown agent: ${agentId}`));
  return deps.manager.spawnOnce(agentId, () => spawnSession(deps, agentId));
}

async function spawnSession(
  deps: {
    manager: AgentManager;
    resolveClient: (provider: string) => AgentClient;
    logger?: Logger;
  },
  agentId: string,
): Promise<AgentSession> {
  const managed = deps.manager.get(agentId);
  if (!managed) throw new Error(`unknown agent: ${agentId}`);
  const { record } = managed;
  const client = deps.resolveClient(record.provider);
  const cwd = record.cwd;
  const handle = record.persistence;
  // Resume must re-apply the persisted system prompt: Pi takes it as a spawn flag
  // (`--append-system-prompt`), so a fresh process without it silently loses capability-gated
  // instructions (inline images, file links, mermaid) composed at create time.
  const session = handle
    ? await client.resumeSession(
        handle as PersistenceHandle,
        { cwd, systemPrompt: record.config?.systemPrompt },
        { cwd },
      )
    : await client.createSession(
        { provider: record.provider, cwd, ...record.config } as Parameters<
          AgentClient["createSession"]
        >[0],
        { cwd },
      );

  try {
    if (!handle) {
      const modelId = record.config?.model;
      const modelProvider = record.config?.modelProvider;
      if (modelId && modelProvider) await session.setProviderModel?.(modelProvider, modelId);
      // Replay the pinned thinking level strictly AFTER the model (sprint-070/task-003): Pi
      // clamps thinking against the model, so a thinking-first replay would be silently
      // overwritten by the model switch's own clamp. Skipped entirely when the record has no
      // explicit pick — never clobber Pi's own restored/default level with a synthetic value.
      // On RESUME the block does not run — Pi restores its own level from the session JSONL,
      // exactly like the model, and with the clamp write-back (slash-command-operations.ts)
      // config and JSONL cannot diverge, so the restored value already matches the record.
      const thinking = record.config?.thinkingOptionId;
      if (thinking) await session.setThinkingOption?.(thinking);
    }
    // Archived or deleted while the process started: nothing owns this session any more.
    const current = deps.manager.get(agentId);
    if (!current || current.record.archivedAt) {
      throw new Error(`agent ${agentId} was closed while its session started`);
    }
  } catch (error) {
    await session.close().catch(() => {});
    throw error;
  }

  deps.manager.attachSession(agentId, session);
  await deps.manager.persistSessionHandle(agentId);
  deps.logger?.info(
    { agentId, firstSpawn: !handle },
    handle ? "agent session resumed" : "agent session spawned (deferred draft)",
  );
  return session;
}

export class AgentService {
  private readonly now: () => string;

  constructor(private readonly deps: AgentServiceDeps) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  registerHandlers(registry: HandlerRegistry, getActiveSessions: () => Iterable<Session>): void {
    registry.register("create_agent_request", (ctx) =>
      this.handleCreate(ctx.message, getActiveSessions, ctx.session),
    );
    registry.register("send_agent_prompt", (ctx) =>
      this.handleSendPrompt(ctx.message, getActiveSessions),
    );
  }

  private broadcastAll(sessions: Iterable<Session>, message: unknown): void {
    this.deps.broadcast(sessions, message);
  }

  async handleCreate(
    msg: Record<string, unknown>,
    getSessions: () => Iterable<Session>,
    wsSession?: Session,
  ): Promise<unknown> {
    const requestId = (msg.requestId as string) ?? randomUUID();
    const config = msg.config as Record<string, unknown> | undefined;
    if (!config) throw new Error("missing config");
    const provider = (config.provider as string | undefined) ?? "mock";
    const cwd = (config.cwd as string | undefined) ?? ".";
    const initialPrompt = msg.initialPrompt as string | undefined;
    const title = (config.title as string | undefined) ?? (msg.title as string | undefined);
    const labels = (msg.labels as Record<string, string> | undefined) ?? {};
    if (title && !labels["title"]) labels["title"] = title;
    const clientMessageId = msg.clientMessageId as string | undefined;
    const autoArchive = Boolean(msg.autoArchive);
    // Compose the system prompt from capability-gated instructions. When the creating connection
    // advertises capabilities like `inline_image_markdown` or `file_link_markdown`, their
    // instruction blocks are appended to the persisted system prompt in a stable order, never
    // mutating the caller's `config`, and never reordering/replacing a caller-supplied prompt:
    // it always comes first, the instructions always after, separated by a blank line. Absent
    // stays absent when no capabilities are advertised (e.g. every CLI-created session).
    const effectiveConfig = {
      ...config,
      systemPrompt: composeSystemPrompt(
        config.systemPrompt as string | undefined,
        (flag) => wsSession?.supports(flag) ?? false,
      ),
    };

    // 1. Create the agent record at status "initializing". `config` is persisted verbatim
    // (`AgentRecord.config`) so a deferred draft (no `initialPrompt`, see step 2) can still spawn
    // with it later, and so a materialized model pick (`config.model`/`config.modelProvider`)
    // survives to first spawn (`spawnOrResumeSession` below).
    const record: AgentRecord = {
      id: randomUUID(),
      provider,
      cwd,
      createdAt: this.now(),
      updatedAt: this.now(),
      labels,
      lastStatus: "initializing",
      config: effectiveConfig as AgentRecord["config"],
    };

    await this.deps.manager.add(record);
    const agentId = record.id;
    this.broadcastAll(getSessions(), {
      type: "agent_update",
      agentId,
      status: "initializing",
      labels,
    });

    // 2. Deferred draft: no `initialPrompt` → persist the record and stop here, WITHOUT spawning
    // a provider process. A brand-new chat tab materializes into exactly this shape the instant
    // the user picks a model or starts typing (web-client `ensureMaterialized`) — persisted so it
    // survives a reload/reconnect, but costing nothing (no process, no Pi-owned JSONL session
    // file) until the first real send actually needs one. That first send (`handleSendPrompt`) or
    // an explicit `resume_agent` (`session-operations.ts`) spawns it via `spawnOrResumeSession`,
    // which also replays any pinned model. Every other caller of this RPC (CLI `run`, scheduled/loop
    // agents) always passes `initialPrompt`, so this branch is
    // new behavior only for the web-client's deferred-draft path, never a regression for them.
    if (!initialPrompt) {
      await this.deps.manager.setStatus(agentId, "idle");
      this.deps.logger?.info(
        { agentId, provider, model: config.model, cwd, title },
        "agent created (deferred draft, no process spawned)",
      );
      this.broadcastAll(getSessions(), { type: "agent_update", agentId, status: "idle", labels });
      return { type: "create_agent_response", requestId, payload: { agentId } };
    }

    // 3. Eager path: spawn now and run the initial prompt. The agent is the turn's until it ends:
    // a send that arrives once `agent_update` has announced the id is refused with `busy`.
    await this.deps.manager.runExclusive(agentId, "turn", async () => {
      const session = await this.deps.manager.spawnOnce(agentId, async () => {
        const created = await this.createEagerSession(agentId, provider, cwd, effectiveConfig);
        this.deps.manager.attachSession(agentId, created);
        return created;
      });
      await this.deps.manager.persistSessionHandle(agentId);
      await this.deps.manager.setStatus(agentId, "idle");
      this.deps.logger?.info(
        {
          agentId,
          provider,
          model: config.model,
          cwd,
          title,
          autoArchive: autoArchive || undefined,
        },
        "agent created",
      );
      this.broadcastAll(getSessions(), { type: "agent_update", agentId, status: "idle", labels });

      await this.runTurn(agentId, session, initialPrompt, getSessions, {
        clientMessageId,
        autoArchive,
        images: msg.images as ImageAttachment[] | undefined,
      });
    });

    return {
      type: "create_agent_response",
      requestId,
      payload: { agentId },
    };
  }

  /** First spawn of a freshly created agent (`handleCreate` step 3); logs a provider failure. */
  private async createEagerSession(
    agentId: string,
    provider: string,
    cwd: string,
    config: Record<string, unknown>,
  ): Promise<AgentSession> {
    try {
      return await this.deps
        .resolveClient(provider)
        .createSession(
          { provider, cwd, ...config } as Parameters<AgentClient["createSession"]>[0],
          {
            cwd,
          },
        );
    } catch (error) {
      this.deps.logger?.error(
        {
          agentId,
          provider,
          model: config.model,
          cwd,
          err: (error as Error)?.message ?? String(error),
        },
        "agent provider session failed",
      );
      throw error;
    }
  }

  async handleSendPrompt(
    msg: Record<string, unknown>,
    getSessions: () => Iterable<Session>,
  ): Promise<unknown> {
    const agentId = msg.agentId as string;
    const prompt = msg.prompt as string;
    const managed = this.deps.manager.get(agentId);
    if (!managed) throw new Error(`unknown agent: ${agentId}`);

    // One turn at a time: claimed before the spawn below, so two concurrent sends cannot both
    // start a turn (each would subscribe and broadcast every later event twice). The workbench
    // steers while a turn runs instead of sending; a send that loses the race gets `busy`.
    await this.deps.manager.runExclusive(agentId, "turn", async () => {
      // No live provider session — either a daemon restart (reloads records but never
      // auto-resumes runtime, daemon-bootstrap.md § Recovery) or a deferred draft's first-ever
      // send. Either way, `spawnOrResumeSession` resumes from the persisted handle or, for a
      // draft that was never spawned, spawns it for the first time and replays its pinned model.
      const session = await ensureSession(this.deps, agentId);

      await this.runTurn(agentId, session, prompt, getSessions, {
        clientMessageId: msg.clientMessageId as string | undefined,
        images: msg.images as ImageAttachment[] | undefined,
      });
    });
    return { type: "agent_prompt_response", agentId, status: "idle" };
  }

  async runTurn(
    agentId: string,
    session: AgentSession,
    prompt: string,
    getSessions: () => Iterable<Session>,
    opts: RunOptions & { clientMessageId?: string; autoArchive?: boolean } = {},
  ): Promise<void> {
    const timeline = timelineFor(this.deps, agentId);
    timeline.startEpoch();

    await this.deps.manager.setStatus(agentId, "running");
    const turnStartedAt = Date.now();
    // Log prompt SIZE, never the prompt itself — message contents are user data, not ops metadata.
    this.deps.logger?.info({ agentId, promptChars: prompt.length }, "turn started");
    this.broadcastAll(getSessions(), { type: "agent_update", agentId, status: "running" });
    // Fire-and-forget: runs concurrently with the turn below, never delays it. See
    // `maybeGenerateTitle` for the write-once/decline-retry contract.
    this.maybeGenerateTitle(agentId, session, prompt, getSessions);

    let userMessageEmitted = false;
    let userMessageId: string | undefined;

    const unsubscribe = session.subscribe((event: AgentStreamEvent) => {
      // Canonical user_message: emit exactly once keyed by provider message id.
      if (event.kind === "user_message" && !userMessageEmitted) {
        const msgId = event.messageId ?? opts.clientMessageId ?? randomUUID();
        if (userMessageId === undefined || userMessageId === msgId) {
          userMessageId = msgId;
          userMessageEmitted = true;
          const userRow = timeline.append({
            kind: "user_message",
            messageId: msgId,
            text: prompt,
            images: opts.images,
          });
          this.broadcastAll(agentStreamRecipients(getSessions()), {
            type: "session",
            message: {
              type: "agent_stream",
              agentId,
              seq: userRow.seq,
              timestamp: userRow.timestamp,
              event: { kind: "user_message", messageId: msgId, text: prompt, images: opts.images },
            },
          });
          return;
        }
      }

      // All other events: append + broadcast.
      appendStreamEvent(agentId, timeline, event, this.deps.broadcast, getSessions());
    });

    // If provider never emits a user_message, emit one ourselves.
    if (!userMessageEmitted) {
      const msgId = opts.clientMessageId ?? randomUUID();
      userMessageId = msgId;
      const row = timeline.append({
        kind: "user_message",
        messageId: msgId,
        text: prompt,
        images: opts.images,
      });
      this.broadcastAll(agentStreamRecipients(getSessions()), {
        type: "session",
        message: {
          type: "agent_stream",
          agentId,
          seq: row.seq,
          timestamp: row.timestamp,
          event: { kind: "user_message", messageId: msgId, text: prompt, images: opts.images },
        },
      });
    }

    // A turn MUST always leave the agent in a recoverable state, on every exit path. `session.run`
    // can reject outright rather than ending with a terminal event: a Pi ack rejected at preflight
    // (missing/invalid credentials, provider 403/429, "Agent is already processing") propagates
    // straight out of `run`/`runSlashPrompt`. Finalizing only on the happy path pinned the agent at
    // "running" forever — the composer then offers Steer instead of Send, steering an agent with no
    // live turn answers `{ok:false}`, and every later message in that conversation rendered
    // "failed to send" with no way back. The rejection is still rethrown below, after the status is
    // settled, so the caller's RPC fails as before.
    let runError: unknown;
    let runRejected = false;
    try {
      await session.run(prompt, opts);
    } catch (err) {
      runError = err;
      runRejected = true;
    } finally {
      unsubscribe();
    }

    // The agent was archived or deleted while the turn ran (the close ended it): nothing is left to
    // settle, and the rejection `run()` may carry is the close's own doing, not a failure.
    const finalManaged = this.deps.manager.get(agentId);
    if (!finalManaged || finalManaged.record.lastStatus === "closed") {
      this.deps.logger?.info({ agentId }, "turn ended: agent closed");
      return;
    }
    const lastEvent = timeline.allRows().at(-1)?.event;
    const newStatus =
      runRejected || lastEvent?.kind === "turn_failed" || lastEvent?.kind === "error"
        ? "error"
        : "idle";
    this.deps.logger?.info(
      { agentId, outcome: newStatus, durationMs: Date.now() - turnStartedAt },
      newStatus === "error" ? "turn failed" : "turn finished",
    );

    await this.deps.manager.setStatus(agentId, newStatus);
    this.broadcastAll(getSessions(), { type: "agent_update", agentId, status: newStatus });

    // autoArchive hook (worktree coupling wired in sprint-008).
    if (
      opts.autoArchive &&
      (lastEvent?.kind === "turn_completed" ||
        lastEvent?.kind === "turn_failed" ||
        lastEvent?.kind === "turn_canceled") &&
      finalManaged
    ) {
      await this.deps.manager.archiveAgent(agentId);
    }

    // Status is settled and broadcast; surface the original failure to the caller unchanged.
    if (runRejected) throw runError;
  }

  /**
   * Fire-and-forget agent title generation on an agent's first substantive prompt. Never awaited
   * by the caller — runs concurrently with the turn itself, so a slow/unavailable provider never
   * delays the actual response.
   *
   * Gates (all must pass to fire): `deps.generateAgentTitle` configured, the record has no title
   * yet (`record.title` — a rename — and `record.labels.title` — an explicit create-time pick —
   * are both write-once: once either is set, this never fires again for that agent), the prompt
   * isn't a slash command, and no generation is already in flight for this agent.
   *
   * On resolve: re-checks the agent still exists AND is still untitled (closes the race against a
   * concurrent rename, delete, or a second prompt's own generation winning first) before writing.
   * `generateAgentTitle` returning `null` (a candidate actually ran and explicitly declined —
   * `<title/>`, "no real task in this message"; failures instead yield the deterministic fallback,
   * see `structured-generation-runtime.ts`) leaves the record untitled on purpose: the same gate
   * lets the NEXT prompt retry, rather than permanently pinning a low-signal first message as the
   * title.
   */
  private maybeGenerateTitle(
    agentId: string,
    session: AgentSession,
    prompt: string,
    getSessions: () => Iterable<Session>,
  ): void {
    if (!this.deps.generateAgentTitle) return;
    const record = this.deps.manager.get(agentId)?.record;
    if (!record || record.title || record.labels?.["title"]) return;
    if (prompt.trim().startsWith("/")) return;
    if (titleGenerationInFlight.has(agentId)) return;
    titleGenerationInFlight.add(agentId);

    this.deps
      .generateAgentTitle({
        modelProvider: record.config?.modelProvider,
        model: record.config?.model,
        prompt,
      })
      .then(async (title) => {
        if (!title) {
          this.deps.logger?.debug({ agentId }, "agent title generation declined");
          return;
        }
        const current = this.deps.manager.get(agentId);
        if (!current || current.record.title || current.record.labels?.["title"]) return;
        await this.deps.manager.updateRecord(agentId, { title });
        try {
          await (current.session ?? session).setSessionName?.(title);
        } catch {
          // Best-effort sync to the provider's own session name; the daemon record is
          // authoritative and already broadcast below either way.
        }
        this.broadcastAll(getSessions(), { type: "agent_update", agentId, title });
      })
      .catch((err) => {
        this.deps.logger?.warn(
          { agentId, err: err instanceof Error ? err.message : String(err) },
          "agent title generation failed",
        );
      })
      .finally(() => titleGenerationInFlight.delete(agentId));
  }
}
