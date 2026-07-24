import { randomUUID } from "node:crypto";

import type { AgentRecord } from "../persistence/entity-schemas.js";
import type { Session } from "../ws/session.js";
import type { HandlerRegistry } from "../ws/router.js";
import type { AgentManager } from "./agent-manager.js";
import type { AgentClient } from "./provider-contract.js";
import type { AgentService } from "./agent-service.js";
import { getTimeline, spawnOrResumeSession } from "./agent-service.js";
import type { ImageAttachment } from "@av-pi-studio/protocol";

/**
 * Session operations beyond create/first-run (features/agent-sessions.md § Other operations,
 * features/agent-providers.md § Import & resume):
 * - interrupt current turn → `turn_canceled` → `idle`
 * - update config (model/mode/thinking/features/title) without recreating the session
 * - resume a closed session via PersistenceHandle
 * - import a native provider session (seed timeline → publish)
 */

export interface SessionOpsDeps {
  manager: AgentManager;
  resolveClient: (provider: string) => AgentClient;
  service: AgentService;
  broadcast: (sessions: Iterable<Session>, message: unknown) => void;
  now?: () => string;
}

export class SessionOperationsService {
  private readonly now: () => string;

  constructor(private readonly deps: SessionOpsDeps) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  registerHandlers(registry: HandlerRegistry, getActiveSessions: () => Iterable<Session>): void {
    registry.register("interrupt_agent", (ctx) =>
      this.handleInterrupt(ctx.message as Record<string, unknown>, getActiveSessions),
    );
    registry.register("update_agent", (ctx) =>
      this.handleUpdate(ctx.message as Record<string, unknown>, getActiveSessions),
    );
    registry.register("resume_agent", (ctx) =>
      this.handleResume(ctx.message as Record<string, unknown>, getActiveSessions),
    );
    registry.register("import_agent_session", (ctx) =>
      this.handleImport(ctx.message as Record<string, unknown>, getActiveSessions),
    );
    registry.register("steer_agent_request", (ctx) =>
      this.handleSteer(ctx.message as Record<string, unknown>, getActiveSessions, "steer"),
    );
    registry.register("follow_up_agent_request", (ctx) =>
      this.handleSteer(ctx.message as Record<string, unknown>, getActiveSessions, "followUp"),
    );
    // Legacy flat alias.
    registry.registerAlias("cancel_agent", "interrupt_agent");
  }

  private broadcastAll(sessions: Iterable<Session>, msg: unknown): void {
    this.deps.broadcast(sessions, msg);
  }

  async handleInterrupt(
    msg: Record<string, unknown>,
    getSessions: () => Iterable<Session>,
  ): Promise<unknown> {
    const agentId = msg.agentId as string;
    const managed = this.deps.manager.get(agentId);
    if (!managed) return { type: "interrupt_response", agentId, ok: false };

    if (!managed.session) {
      // No live provider session to interrupt (e.g. a daemon restart that hasn't lazily
      // re-attached one yet — see AgentService.handleSendPrompt). If the record is stuck on a
      // status that requires a session — the same impossible state `AgentManager.recover()`
      // reconciles on boot — self-heal it here too, so Stop can clear a session wedged by an
      // out-of-band restart without waiting for the next one. Already idle/error/closed is a
      // legitimate no-op.
      if (managed.record.lastStatus === "running" || managed.record.lastStatus === "initializing") {
        await this.deps.manager.setStatus(agentId, "idle");
        this.broadcastAll(getSessions(), { type: "agent_update", agentId, status: "idle" });
        return { type: "interrupt_response", agentId, ok: true };
      }
      return { type: "interrupt_response", agentId, ok: false };
    }

    await managed.session.interrupt();
    // The provider session will emit turn_canceled which goes through runTurn's subscriber.
    // If the agent is still "running" (interrupt was out-of-band), force it to idle.
    if (managed.record.lastStatus === "running") {
      await this.deps.manager.setStatus(agentId, "idle");
      this.broadcastAll(getSessions(), { type: "agent_update", agentId, status: "idle" });
    }
    return { type: "interrupt_response", agentId, ok: true };
  }

  /**
   * `steer_agent_request` / `follow_up_agent_request` — inject a message into a LIVE turn without
   * starting a new turn (Pi RPC `steer`/`follow_up`, docs/rpc.md). Unlike `send_agent_prompt` this
   * never routes through `runTurn`, never changes agent status, and is only meaningful while the
   * turn is running. We optimistically append the injected text as a `user_message` timeline row so
   * history shows what the user asked for; the provider then confirms queue state asynchronously
   * via `queue_update` events, which flow through the in-flight `runTurn` subscriber.
   */
  async handleSteer(
    msg: Record<string, unknown>,
    getSessions: () => Iterable<Session>,
    kind: "steer" | "followUp",
  ): Promise<unknown> {
    const responseType =
      kind === "steer" ? "steer_agent_response" : "follow_up_agent_response";
    const agentId = msg.agentId as string;
    const message = msg.message as string;
    const images = msg.images as ImageAttachment[] | undefined;
    const managed = this.deps.manager.get(agentId);
    if (!managed || !managed.session) return { type: responseType, agentId, ok: false };

    const fn = kind === "steer" ? managed.session.steer : managed.session.followUp;
    if (!fn) return { type: responseType, agentId, ok: false };

    // Optimistic user_message row (best-effort — only if a live timeline exists for this turn).
    const timeline = getTimeline(agentId);
    if (timeline) {
      const messageId = (msg.clientMessageId as string | undefined) ?? randomUUID();
      const row = timeline.append({ kind: "user_message", messageId, text: message, images });
      this.broadcastAll(getSessions(), {
        type: "session",
        message: {
          type: "agent_stream",
          agentId,
          seq: row.seq,
          timestamp: row.timestamp,
          event: { kind: "user_message", messageId, text: message, images },
        },
      });
    }

    await fn.call(managed.session, message, images ? { images } : undefined);
    return { type: responseType, agentId, ok: true };
  }

  async handleUpdate(
    msg: Record<string, unknown>,
    getSessions: () => Iterable<Session>,
  ): Promise<unknown> {
    const agentId = msg.agentId as string;
    const managed = this.deps.manager.get(agentId);
    if (!managed) throw new Error(`unknown agent: ${agentId}`);

    // Update fields that do NOT require a session recreate.
    const title =
      typeof msg.title === "string" ? msg.title : (managed.record.title as string | undefined);
    const labels = (msg.labels as Record<string, string> | undefined) ?? managed.record.labels;
    const config = {
      ...managed.record.config,
      ...(msg.config as Record<string, unknown> | undefined),
    };

    // Apply mode/model/thinking to the live session (if attached).
    if (managed.session) {
      if (typeof msg.modeId === "string") await managed.session.setMode(msg.modeId);
      if (typeof msg.model === "string") await managed.session.setModel?.(msg.model);
      if (typeof msg.thinkingOptionId === "string") {
        await managed.session.setThinkingOption?.(msg.thinkingOptionId);
      }
    }

    // Persist updated record without recreating the session — actually write it to disk
    // (`$PI_STUDIO_HOME/agents/**.json`), not just mutate the in-memory copy.
    await this.deps.manager.updateRecord(agentId, {
      title,
      labels,
      config: config as AgentRecord["config"],
    });
    this.broadcastAll(getSessions(), {
      type: "agent_update",
      agentId,
      status: managed.record.lastStatus,
      title,
      labels,
    });
    return { type: "update_agent_response", agentId, ok: true };
  }

  async handleResume(
    msg: Record<string, unknown>,
    getSessions: () => Iterable<Session>,
  ): Promise<unknown> {
    const agentId = msg.agentId as string;
    // Always spawns/resumes fresh, even over an already-live session (an explicit resume is a
    // deliberate "restart the process" action) — and, for a deferred draft that was never spawned
    // (`record.persistence` absent), first-spawns it and replays its pinned model instead of the
    // old "no persistence handle → rpc_error" behavior (see `spawnOrResumeSession`'s doc comment).
    await spawnOrResumeSession(this.deps, agentId);
    await this.deps.manager.setStatus(agentId, "idle");
    this.broadcastAll(getSessions(), {
      type: "agent_update",
      agentId,
      status: "idle",
    });
    return { type: "resume_agent_response", agentId, ok: true };
  }

  async handleImport(
    msg: Record<string, unknown>,
    getSessions: () => Iterable<Session>,
  ): Promise<unknown> {
    const provider = (msg.provider as string) ?? "pi";
    const cwd = (msg.cwd as string) ?? ".";
    const providerHandleId = msg.providerHandleId as string;

    const client = this.deps.resolveClient(provider);
    if (!client.importSession) throw new Error(`provider ${provider} does not support import`);

    const result = await client.importSession({ providerHandleId, cwd });

    // Create the agent record and seed the timeline BEFORE publishing.
    const record: AgentRecord = {
      id: randomUUID(),
      provider,
      cwd,
      createdAt: this.now(),
      updatedAt: this.now(),
      labels: {},
      lastStatus: "idle",
      timeline: result.timeline.map((e) => ({ epoch: 0, seq: 0, timestamp: this.now(), event: e })),
      persistence: result.persistence as unknown as AgentRecord["persistence"],
    };

    const managed = await this.deps.manager.add(record);
    this.deps.manager.attachSession(record.id, result.session);

    // Publish only once the agent is ready.
    this.broadcastAll(getSessions(), {
      type: "agent_update",
      agentId: record.id,
      status: "idle",
    });
    return {
      type: "import_agent_session_response",
      agentId: record.id,
      ok: true,
    };
  }
}
