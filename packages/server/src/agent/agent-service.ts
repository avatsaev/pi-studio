import { randomUUID } from "node:crypto";

import type { AgentStreamEvent, ImageAttachment } from "@av-pi-studio/protocol";
import { CLIENT_CAPS } from "@av-pi-studio/protocol";

import type { AgentRecord } from "../persistence/entity-schemas.js";
import type { Logger } from "../logging/logger.js";
import type { Session } from "../ws/session.js";
import type { HandlerRegistry } from "../ws/router.js";
import { AgentManager, PARENT_AGENT_ID_LABEL } from "./agent-manager.js";
import type {
  AgentClient,
  AgentSession,
  PersistenceHandle,
  RunOptions,
} from "./provider-contract.js";
import { AgentTimelineStore } from "./timeline-store.js";
import { INLINE_IMAGE_INSTRUCTIONS } from "./inline-image-instructions.js";

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
}

/** In-memory timeline per agentId; persisted rows are on the AgentRecord.timeline. */
const timelinesByAgentId = new Map<string, AgentTimelineStore>();

function getOrCreateTimeline(agentId: string, now?: () => string): AgentTimelineStore {
  let t = timelinesByAgentId.get(agentId);
  if (!t) {
    t = new AgentTimelineStore({ now });
    timelinesByAgentId.set(agentId, t);
  }
  return t;
}

export function getTimeline(agentId: string): AgentTimelineStore | undefined {
  return timelinesByAgentId.get(agentId);
}

/**
 * Seed the in-memory timeline for an agent that has none yet (e.g. right after a daemon restart)
 * from externally rehydrated rows — see `timeline-rpc.ts`'s fallback to a provider's
 * `hydrateTimeline()`. No-op if a timeline already exists (never overwrites live/streamed rows).
 */
export function seedTimeline(
  agentId: string,
  rows: import("./timeline-store.js").TimelineRow[],
): void {
  if (timelinesByAgentId.has(agentId)) return;
  timelinesByAgentId.set(agentId, new AgentTimelineStore({ initialRows: rows }));
}

/**
 * Ensure `agentId` has a live provider session: resume from a persisted handle, or — for a
 * deferred draft that was never spawned (`record.persistence` absent; see `AgentService.handleCreate`
 * step 2) — spawn it for the first time. Either way, replay the record's pinned model
 * (`config.model`/`config.modelProvider`, written when a draft materializes — see
 * `slash-command-operations.ts` `persistModel` and the web-client's `ensureMaterialized`) via
 * `setProviderModel`, since neither `createSession` nor `resumeSession` consult
 * `AgentSessionConfig.model` — Pi resolves its own default at spawn regardless
 * (`providers/pi/agent.ts` `discoverState`'s doc comment). Attaches the session and persists its
 * handle either way. Always spawns/resumes fresh — callers that want "reuse the live session if
 * there is one" check `managed.session` themselves first (`AgentService.handleSendPrompt` does;
 * `SessionOperationsService.handleResume` intentionally always forces a fresh process).
 */
export async function spawnOrResumeSession(
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
  const session = handle
    ? await client.resumeSession(handle as PersistenceHandle, { cwd }, { cwd })
    : await client.createSession(
        { provider: record.provider, cwd, ...record.config } as Parameters<
          AgentClient["createSession"]
        >[0],
        { cwd },
      );

  if (!handle) {
    const modelId = record.config?.model;
    const modelProvider = record.config?.modelProvider;
    if (modelId && modelProvider) await session.setProviderModel?.(modelProvider, modelId);
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

    // When the creating connection advertised `inline_image_markdown` (task-006, sprint-045),
    // append the image-rendering instruction to the persisted system prompt — never mutating the
    // caller's `config`, and never reordering/replacing a caller-supplied prompt: it always comes
    // first, the instruction always after, separated by a blank line. Absent stays absent when
    // the capability isn't advertised (e.g. every CLI-created session).
    const effectiveConfig = wsSession?.supports(CLIENT_CAPS.inline_image_markdown)
      ? {
          ...config,
          systemPrompt: [config.systemPrompt as string | undefined, INLINE_IMAGE_INSTRUCTIONS]
            .filter(Boolean)
            .join("\n\n"),
        }
      : config;

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
      timeline: [],
    };

    const managed = await this.deps.manager.add(record);
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
    // which also replays any pinned model. Every other caller of this RPC (CLI `run`, the MCP
    // `create_agent` tool, scheduled/loop agents) always passes `initialPrompt`, so this branch is
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

    // 3. Eager path: spawn now and run the initial prompt.
    const client = this.deps.resolveClient(provider);
    let session: AgentSession;
    try {
      session = await client.createSession(
        { provider, cwd, ...effectiveConfig } as Parameters<AgentClient["createSession"]>[0],
        { cwd },
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
    this.deps.manager.attachSession(agentId, session);
    await this.deps.manager.persistSessionHandle(agentId);
    await this.deps.manager.setStatus(agentId, "idle");
    this.deps.logger?.info(
      { agentId, provider, model: config.model, cwd, title, autoArchive: autoArchive || undefined },
      "agent created",
    );
    this.broadcastAll(getSessions(), { type: "agent_update", agentId, status: "idle", labels });

    await this.runTurn(agentId, session, initialPrompt, getSessions, {
      clientMessageId,
      autoArchive,
      images: msg.images as ImageAttachment[] | undefined,
    });

    return {
      type: "create_agent_response",
      requestId,
      payload: { agentId },
    };
  }

  async handleSendPrompt(
    msg: Record<string, unknown>,
    getSessions: () => Iterable<Session>,
  ): Promise<unknown> {
    const agentId = msg.agentId as string;
    const prompt = msg.prompt as string;
    const managed = this.deps.manager.get(agentId);
    if (!managed) throw new Error(`unknown agent: ${agentId}`);

    // No live provider session — either a daemon restart (reloads records but never
    // auto-resumes runtime, daemon-bootstrap.md § Recovery) or a deferred draft's first-ever
    // send. Either way, `spawnOrResumeSession` resumes from the persisted handle or, for a draft
    // that was never spawned, spawns it for the first time and replays its pinned model.
    const session = managed.session ?? (await spawnOrResumeSession(this.deps, agentId));

    await this.runTurn(agentId, session, prompt, getSessions, {
      clientMessageId: msg.clientMessageId as string | undefined,
      images: msg.images as ImageAttachment[] | undefined,
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
    const timeline = getOrCreateTimeline(agentId, this.now);
    timeline.startEpoch();

    await this.deps.manager.setStatus(agentId, "running");
    const turnStartedAt = Date.now();
    // Log prompt SIZE, never the prompt itself — message contents are user data, not ops metadata.
    this.deps.logger?.info({ agentId, promptChars: prompt.length }, "turn started");
    this.broadcastAll(getSessions(), { type: "agent_update", agentId, status: "running" });

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
          this.broadcastAll(getSessions(), {
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
      const row = timeline.append(event);
      this.broadcastAll(getSessions(), {
        type: "session",
        message: {
          type: "agent_stream",
          agentId,
          seq: row.seq,
          timestamp: row.timestamp,
          event,
        },
      });
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
      this.broadcastAll(getSessions(), {
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

    const finalManaged = this.deps.manager.get(agentId);
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
}
