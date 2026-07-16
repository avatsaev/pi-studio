import { randomUUID } from "node:crypto";

import type { AgentRecord } from "../persistence/entity-schemas.js";
import type { Session } from "../ws/session.js";
import type { HandlerRegistry } from "../ws/router.js";
import type { AgentManager } from "./agent-manager.js";
import type { AgentClient } from "./provider-contract.js";
import type { AgentService } from "./agent-service.js";

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
    if (!managed?.session) return { type: "interrupt_response", agentId, ok: false };

    await managed.session.interrupt();
    // The provider session will emit turn_canceled which goes through runTurn's subscriber.
    // If the agent is still "running" (interrupt was out-of-band), force it to idle.
    if (managed.record.lastStatus === "running") {
      await this.deps.manager.setStatus(agentId, "idle");
      this.broadcastAll(getSessions(), { type: "agent_update", agentId, status: "idle" });
    }
    return { type: "interrupt_response", agentId, ok: true };
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

    // Persist updated record without recreating the session.
    managed.record = {
      ...managed.record,
      title,
      labels,
      config: config as AgentRecord["config"],
      updatedAt: this.now(),
    };
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
    const managed = this.deps.manager.get(agentId);
    if (!managed) throw new Error(`unknown agent: ${agentId}`);

    const handle = managed.record.persistence;
    if (!handle) {
      // Stale / no handle → rpc_error.
      throw new Error(`agent ${agentId} has no persistence handle (stale or not resumable)`);
    }

    const client = this.deps.resolveClient(managed.record.provider);
    const session = await client.resumeSession(
      handle as import("./provider-contract.js").PersistenceHandle,
    );
    this.deps.manager.attachSession(agentId, session);
    await this.deps.manager.persistSessionHandle(agentId);
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
