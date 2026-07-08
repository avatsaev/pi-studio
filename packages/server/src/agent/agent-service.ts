import { randomUUID } from "node:crypto";

import type { AgentStreamEvent } from "@av-pi-studio/protocol";

import type { AgentRecord } from "../persistence/entity-schemas.js";
import type { Session } from "../ws/session.js";
import type { HandlerRegistry } from "../ws/router.js";
import { AgentManager, PARENT_AGENT_ID_LABEL } from "./agent-manager.js";
import type { AgentClient, AgentSession, RunOptions } from "./provider-contract.js";
import { AgentTimelineStore } from "./timeline-store.js";

/**
 * AgentService wires `create_agent_request` + run/turn loop + `agent_stream` broadcast
 * (features/agent-sessions.md § Create / § Behavior, architecture/websocket-protocol.md).
 */

export interface AgentServiceDeps {
  manager: AgentManager;
  resolveClient: (provider: string) => AgentClient;
  broadcast: (sessions: Iterable<Session>, message: unknown) => void;
  now?: () => string;
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

export class AgentService {
  private readonly now: () => string;

  constructor(private readonly deps: AgentServiceDeps) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  registerHandlers(registry: HandlerRegistry, getActiveSessions: () => Iterable<Session>): void {
    registry.register("create_agent_request", (ctx) =>
      this.handleCreate(ctx.message, getActiveSessions),
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

    // 1. Create the agent record at status "initializing".
    const record: AgentRecord = {
      id: randomUUID(),
      provider,
      cwd,
      createdAt: this.now(),
      updatedAt: this.now(),
      labels,
      lastStatus: "initializing",
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

    // 2. Create the provider session → status "idle".
    const client = this.deps.resolveClient(provider);
    const session = await client.createSession(
      { provider, cwd, ...config } as Parameters<AgentClient["createSession"]>[0],
      { cwd },
    );
    this.deps.manager.attachSession(agentId, session);
    await this.deps.manager.setStatus(agentId, "idle");
    this.broadcastAll(getSessions(), { type: "agent_update", agentId, status: "idle", labels });

    // 3. Run initial prompt if provided.
    if (initialPrompt) {
      await this.runTurn(agentId, session, initialPrompt, getSessions, {
        clientMessageId,
        autoArchive,
      });
    }

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
    if (!managed?.session) throw new Error(`no live session for agent ${agentId}`);
    await this.runTurn(agentId, managed.session, prompt, getSessions, {
      clientMessageId: msg.clientMessageId as string | undefined,
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
          const userRow = timeline.append({ kind: "user_message", messageId: msgId, text: prompt });
          this.broadcastAll(getSessions(), {
            type: "session",
            message: {
              type: "agent_stream",
              agentId,
              seq: userRow.seq,
              timestamp: userRow.timestamp,
              event: { kind: "user_message", messageId: msgId, text: prompt },
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
      const row = timeline.append({ kind: "user_message", messageId: msgId, text: prompt });
      this.broadcastAll(getSessions(), {
        type: "session",
        message: {
          type: "agent_stream",
          agentId,
          seq: row.seq,
          timestamp: row.timestamp,
          event: { kind: "user_message", messageId: msgId, text: prompt },
        },
      });
    }

    try {
      await session.run(prompt, opts);
    } finally {
      unsubscribe();
    }

    const finalManaged = this.deps.manager.get(agentId);
    const lastEvent = timeline.allRows().at(-1)?.event;
    const newStatus =
      lastEvent?.kind === "turn_failed" || lastEvent?.kind === "error" ? "error" : "idle";

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
  }
}
