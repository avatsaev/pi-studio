import type { AgentStatus } from "@av-pi-studio/protocol";

import {
  loadAllAgents as loadAllAgentsFromDisk,
  saveAgent as saveAgentToDisk,
} from "../persistence/entity-stores.js";
import type { AgentRecord } from "../persistence/entity-schemas.js";
import type { AgentSession } from "./provider-contract.js";

/**
 * AgentManager — the single source of truth for agent lifecycle state
 * (architecture/agent-lifecycle.md § States / § Lifecycle status semantics / § Relationship labels,
 * daemon-bootstrap.md § Recovery). State changes persist to the agent record AND broadcast
 * `agent_update` to all subscribers. Status is **literal**: a parent stays `idle` even while a child
 * runs.
 */

export const PARENT_AGENT_ID_LABEL = "pi-studio.parent-agent-id";

/** A managed agent: its persisted record, optional live session, and derived parent id. */
export interface ManagedAgent {
  record: AgentRecord;
  session: AgentSession | null;
  parentAgentId: string | null;
}

/** Broadcast shape for an `agent_update` (matches the protocol session message). */
export interface AgentUpdateBroadcast {
  type: "agent_update";
  agentId: string;
  status: AgentStatus;
  title?: string;
  labels: Record<string, string>;
}

/** Broadcast shape for an `agent_archived` lifecycle event. */
export interface AgentArchivedBroadcast {
  type: "agent_archived";
  agentId: string;
  archivedAt: string;
}

export type AgentManagerEvent = AgentUpdateBroadcast | AgentArchivedBroadcast;
export type AgentManagerSubscriber = (event: AgentManagerEvent) => void;

export class InvalidAgentTransitionError extends Error {
  constructor(from: AgentStatus, to: AgentStatus) {
    super(`invalid agent transition: ${from} → ${to}`);
    this.name = "InvalidAgentTransitionError";
  }
}

// initializing → idle ⇄ running ; idle/running → error → closed (closed is terminal).
const ALLOWED_TRANSITIONS: Record<AgentStatus, ReadonlySet<AgentStatus>> = {
  initializing: new Set<AgentStatus>(["idle", "error", "closed"]),
  idle: new Set<AgentStatus>(["running", "error", "closed"]),
  running: new Set<AgentStatus>(["idle", "error", "closed"]),
  error: new Set<AgentStatus>(["idle", "closed"]),
  closed: new Set<AgentStatus>(),
};

export function canTransition(from: AgentStatus, to: AgentStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].has(to);
}

export interface AgentManagerDeps {
  home: string;
  saveAgent?: (record: AgentRecord) => Promise<void>;
  loadAllAgents?: () => Promise<AgentRecord[]>;
  /** Loop service hook: recover `running` loops as `stopped` with an interruption log entry. */
  onRecoverLoops?: () => Promise<void> | void;
  now?: () => string;
}

export class AgentManager {
  private readonly agents = new Map<string, ManagedAgent>();
  private readonly subscribers = new Set<AgentManagerSubscriber>();
  private readonly save: (record: AgentRecord) => Promise<void>;
  private readonly loadAll: () => Promise<AgentRecord[]>;
  private readonly now: () => string;

  constructor(private readonly deps: AgentManagerDeps) {
    this.save = deps.saveAgent ?? ((record) => saveAgentToDisk(deps.home, record));
    this.loadAll = deps.loadAllAgents ?? (() => loadAllAgentsFromDisk(deps.home));
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  subscribe(cb: AgentManagerSubscriber): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private broadcast(record: AgentRecord): void {
    const update: AgentUpdateBroadcast = {
      type: "agent_update",
      agentId: record.id,
      status: record.lastStatus,
      ...(record.title ? { title: record.title } : {}),
      labels: record.labels,
    };
    for (const cb of this.subscribers) cb(update);
  }

  private wrap(record: AgentRecord, session: AgentSession | null = null): ManagedAgent {
    return {
      record,
      session,
      parentAgentId: record.labels[PARENT_AGENT_ID_LABEL] ?? null,
    };
  }

  /** Register a new agent: persist + broadcast its initial state. */
  async add(record: AgentRecord): Promise<ManagedAgent> {
    const managed = this.wrap(record);
    this.agents.set(record.id, managed);
    await this.save(record);
    this.broadcast(record);
    return managed;
  }

  attachSession(id: string, session: AgentSession): void {
    const managed = this.agents.get(id);
    if (managed) managed.session = session;
  }

  /** Transition an agent's `lastStatus`, persisting and broadcasting the change. */
  async setStatus(id: string, status: AgentStatus): Promise<ManagedAgent> {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`unknown agent: ${id}`);

    const from = managed.record.lastStatus;
    if (!canTransition(from, status)) throw new InvalidAgentTransitionError(from, status);

    managed.record = { ...managed.record, lastStatus: status, updatedAt: this.now() };
    await this.save(managed.record);
    this.broadcast(managed.record);
    return managed;
  }

  get(id: string): ManagedAgent | undefined {
    return this.agents.get(id);
  }

  /** Active (non-archived) agents. */
  list(): ManagedAgent[] {
    return [...this.agents.values()].filter((m) => !m.record.archivedAt);
  }

  /** Every tracked agent, including archived. */
  listAll(): ManagedAgent[] {
    return [...this.agents.values()];
  }

  parentAgentId(id: string): string | null {
    return this.agents.get(id)?.parentAgentId ?? null;
  }

  private broadcastArchived(agentId: string, archivedAt: string): void {
    const event: AgentArchivedBroadcast = { type: "agent_archived", agentId, archivedAt };
    for (const cb of this.subscribers) cb(event);
  }

  /**
   * Archive (soft delete) an agent and recursively cascade to its non-detached children
   * (architecture/agent-lifecycle.md § Archive). Snapshots the session's persistence handle, sets
   * `archivedAt`, normalizes `lastStatus` away from running/initializing, notifies subscribers,
   * closes/kills the runtime, then archives each child whose parent label points at this agent.
   * Detached agents (no parent label) are never cascade-archived. Idempotent.
   */
  async archiveAgent(id: string): Promise<void> {
    const managed = this.agents.get(id);
    if (!managed || managed.record.archivedAt) return;

    // Snapshot the live session's persistence handle so the record can resume later.
    let persistence = managed.record.persistence;
    if (managed.session) {
      const handle = managed.session.describePersistence();
      if (handle) persistence = handle as AgentRecord["persistence"];
    }

    const archivedAt = this.now();
    const lastStatus =
      managed.record.lastStatus === "running" || managed.record.lastStatus === "initializing"
        ? "closed"
        : managed.record.lastStatus;

    managed.record = {
      ...managed.record,
      archivedAt,
      lastStatus,
      ...(persistence ? { persistence } : {}),
      updatedAt: archivedAt,
    };
    await this.save(managed.record);

    // Close the runtime (kills the process if still running).
    if (managed.session) {
      await managed.session.close();
      managed.session = null;
    }

    this.broadcastArchived(id, archivedAt);

    // Cascade to non-detached children (those whose parent label == this id).
    for (const child of this.listAll()) {
      if (child.record.id !== id && child.parentAgentId === id && !child.record.archivedAt) {
        await this.archiveAgent(child.record.id);
      }
    }
  }

  /**
   * Boot recovery: rehydrate persisted agents (runtime is NOT auto-resumed — records only), then run
   * the loop-recovery hook (`running` loops → `stopped`). Returns the number of agents reloaded.
   */
  async recover(): Promise<number> {
    const records = await this.loadAll();
    for (const record of records) {
      this.agents.set(record.id, this.wrap(record, null));
    }
    await this.deps.onRecoverLoops?.();
    return records.length;
  }
}
