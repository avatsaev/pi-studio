import type { AgentStatus } from "@av-pi-studio/protocol";

import {
  deleteAgent as deleteAgentFromDisk,
  loadAllAgents as loadAllAgentsFromDisk,
  saveAgent as saveAgentToDisk,
} from "../persistence/entity-stores.js";
import type { AgentRecord } from "../persistence/entity-schemas.js";
import type { Logger } from "../logging/logger.js";
import { PI_KILL_GRACE_MS } from "./providers/pi/rpc-transport.js";
import type { AgentSession } from "./provider-contract.js";

/**
 * AgentManager — the single source of truth for agent lifecycle state
 * (architecture/agent-lifecycle.md § States / § Lifecycle status semantics / § Relationship labels,
 * daemon-bootstrap.md § Recovery). State changes persist to the agent record AND broadcast
 * `agent_update` to all subscribers. Status is **literal**: a parent stays `idle` even while a child
 * runs.
 */

export const PARENT_AGENT_ID_LABEL = "pi-studio.parent-agent-id";

/**
 * Margin added to the transport's SIGKILL grace in `AGENT_CLOSE_TIMEOUT_MS`: a Pi that ignores
 * SIGTERM must be SIGKILLed, and its exit seen, before the manager stops waiting for it.
 */
const AGENT_CLOSE_MARGIN_MS = 2_000;

/** Per-session limit for `closeAll()` at daemon shutdown: the SIGKILL grace plus a margin. */
export const AGENT_CLOSE_TIMEOUT_MS = PI_KILL_GRACE_MS + AGENT_CLOSE_MARGIN_MS;

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

/** Broadcast shape for an `agent_deleted` lifecycle event (hard delete — no persisted trace). */
export interface AgentDeletedBroadcast {
  type: "agent_deleted";
  agentId: string;
}

export type AgentManagerEvent =
  | AgentUpdateBroadcast
  | AgentArchivedBroadcast
  | AgentDeletedBroadcast;
export type AgentManagerSubscriber = (event: AgentManagerEvent) => void;

export class InvalidAgentTransitionError extends Error {
  constructor(from: AgentStatus, to: AgentStatus) {
    super(`invalid agent transition: ${from} → ${to}`);
    this.name = "InvalidAgentTransitionError";
  }
}

// initializing → idle ⇄ running ; idle/running → error → idle|running|closed (closed is terminal).
//
// `error` is recoverable, not terminal: it means "the last turn failed, session still attached"
// (architecture/agent-lifecycle.md § States), and sending another prompt is precisely how a user
// recovers — fix the upstream cause (bad API key, exhausted quota, provider 403/429) and retry the
// same conversation. Without the `error → running` edge, `runTurn`'s opening `setStatus(running)`
// threw `InvalidAgentTransitionError` for every subsequent send, so one provider error wedged the
// conversation permanently: each later message was rejected in ~1ms and rendered "failed to send",
// with no way back short of closing the agent. The edge also guarded nothing — `error → idle →
// running` was already reachable in two hops.
const ALLOWED_TRANSITIONS: Record<AgentStatus, Partial<Record<AgentStatus, true>>> = {
  initializing: { idle: true, error: true, closed: true },
  idle: { running: true, error: true, closed: true },
  running: { idle: true, error: true, closed: true },
  error: { idle: true, running: true, closed: true },
  closed: {},
};

export function canTransition(from: AgentStatus, to: AgentStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from][to] === true;
}

export interface AgentManagerDeps {
  home: string;
  saveAgent?: (record: AgentRecord) => Promise<void>;
  loadAllAgents?: () => Promise<AgentRecord[]>;
  /** Delete a persisted agent record file by (cwd, id). Injectable for tests. */
  deleteAgent?: (cwd: string, id: string) => Promise<boolean>;
  /** Session-attach hook (features/extension-ui-rpc.md § New/changed files) — invoked at the end of
   *  `attachSession()`, the single choke point every spawn/resume/import path already funnels
   *  through (`agent-service.ts:104`, `:228`). A throwing hook is logged and never prevents the
   *  session from being attached. Optional: existing constructions that pass none behave exactly
   *  as before. */
  onSessionAttached?: (agentId: string, session: AgentSession) => void;
  logger?: Logger;
  now?: () => string;
}

/**
 * What keeps an agent from starting anything else (`AgentManager.runExclusive`): a running turn, a
 * compaction, or a session operation (new session, switch, fork, clone).
 */
export type BusyKind = "turn" | "compaction" | "session";

const BUSY_REASON: Record<BusyKind, string> = {
  turn: "is running",
  compaction: "is compacting",
  session: "is changing its session",
};

export class AgentManager {
  private readonly agents = new Map<string, ManagedAgent>();
  private readonly busy = new Map<string, BusyKind>();
  private readonly spawns = new Map<string, Promise<AgentSession>>();
  private readonly subscribers = new Set<AgentManagerSubscriber>();
  private readonly save: (record: AgentRecord) => Promise<void>;
  private readonly loadAll: () => Promise<AgentRecord[]>;
  private readonly delete: (cwd: string, id: string) => Promise<boolean>;
  private readonly now: () => string;

  constructor(private readonly deps: AgentManagerDeps) {
    this.save = deps.saveAgent ?? ((record) => saveAgentToDisk(deps.home, record));
    this.loadAll = deps.loadAllAgents ?? (() => loadAllAgentsFromDisk(deps.home));
    this.delete = deps.deleteAgent ?? ((cwd, id) => deleteAgentFromDisk(deps.home, cwd, id));
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

  /**
   * Run `fn` as the agent's only turn, compaction or session operation. A second one started while
   * it runs is refused at once with `busy: agent <id> <reason>` (the router answers `rpc_error`),
   * before it can spawn, subscribe or touch the timeline. The claim is taken synchronously when
   * this is called and released when `fn` settles, whatever the outcome. Model and thinking-level
   * changes do not claim: Pi applies them to the next turn.
   */
  async runExclusive<T>(id: string, kind: BusyKind, fn: () => Promise<T>): Promise<T> {
    const held = this.busy.get(id);
    if (held) throw new Error(`busy: agent ${id} ${BUSY_REASON[held]}`);
    this.busy.set(id, kind);
    try {
      return await fn();
    } finally {
      this.busy.delete(id);
    }
  }

  /**
   * Run `spawn` unless one is already in flight for this agent, in which case every caller awaits
   * the same promise: an agent never has two Pi processes starting at once. `spawn` is expected to
   * attach the session it produces before it resolves.
   */
  spawnOnce(id: string, spawn: () => Promise<AgentSession>): Promise<AgentSession> {
    const inFlight = this.spawns.get(id);
    if (inFlight) return inFlight;
    const started = spawn().finally(() => this.spawns.delete(id));
    this.spawns.set(id, started);
    return started;
  }

  /** Attach `session` as the agent's live one. A previous live session is closed, never leaked. */
  attachSession(id: string, session: AgentSession): void {
    const managed = this.agents.get(id);
    if (!managed) return;
    const previous = managed.session;
    managed.session = session;
    if (previous && previous !== session) {
      previous.close().catch((err: unknown) => {
        this.deps.logger?.warn(
          { agentId: id, err: err instanceof Error ? err.message : String(err) },
          "agent-manager: closing the replaced agent session failed",
        );
      });
    }
    session.onExit?.((reason) => this.detachDeadSession(id, session, reason));
    if (!this.deps.onSessionAttached) return;
    try {
      this.deps.onSessionAttached(id, session);
    } catch (err) {
      this.deps.logger?.warn(
        { agentId: id, err: err instanceof Error ? err.message : String(err) },
        "agent-manager: onSessionAttached hook failed",
      );
    }
  }

  /**
   * The session's runtime ended on its own (`AgentSession.onExit`): detach it and mark the agent
   * `error`, so the next prompt resumes from the persisted handle instead of writing to a dead
   * process. A turn in progress has already ended as `turn_failed`, and its `runTurn` settles the
   * same status. A session that is no longer the attached one (archived, replaced) is ignored.
   */
  private detachDeadSession(id: string, session: AgentSession, reason: string): void {
    const managed = this.agents.get(id);
    if (!managed || managed.session !== session) return;
    managed.session = null;
    this.deps.logger?.warn({ agentId: id, reason }, "agent session ended on its own; detached");
    if (managed.record.lastStatus === "closed") return;
    this.setStatus(id, "error").catch((err: unknown) => {
      this.deps.logger?.warn(
        { agentId: id, err: err instanceof Error ? err.message : String(err) },
        "agent-manager: marking a dead session's agent as error failed",
      );
    });
  }

  /**
   * Snapshot and persist the live session's resume handle (e.g. Pi's on-disk JSONL session file)
   * onto the record. Called right after session creation/attach so a plain daemon restart — not
   * just an archive — leaves a handle behind: without one, `fetch_agent_timeline_request` has no
   * way to rebuild an agent's conversation once its in-memory timeline is gone
   * (architecture/persistence.md § Agent record `persistence` field).
   */
  async persistSessionHandle(id: string): Promise<void> {
    const managed = this.agents.get(id);
    if (!managed?.session) return;
    const handle = managed.session.describePersistence();
    if (!handle) return;
    managed.record = {
      ...managed.record,
      persistence: handle as AgentRecord["persistence"],
      updatedAt: this.now(),
    };
    await this.save(managed.record);
  }

  /**
   * Merge arbitrary persisted record fields (title, labels, config, …) and write them to disk.
   * Does NOT broadcast — per the existing convention (see daemon/bootstrap.ts's `manager.subscribe`
   * comment), each RPC call site owns its own WS broadcast shape/timing; this only guarantees the
   * mutation actually reaches `$PI_STUDIO_HOME/agents/**.json` instead of living in memory only.
   */
  async updateRecord(id: string, patch: Partial<AgentRecord>): Promise<ManagedAgent> {
    const managed = this.agents.get(id);
    if (!managed) throw new Error(`unknown agent: ${id}`);
    managed.record = { ...managed.record, ...patch, updatedAt: this.now() };
    await this.save(managed.record);
    return managed;
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
   * A running turn is interrupted before its session is closed, so the provider gets to cancel it
   * (`turn_canceled`) rather than only losing its process. A failing interrupt is logged and does
   * not stop the archive or delete: the close that follows ends the turn anyway.
   */
  private async interruptRunningTurn(managed: ManagedAgent): Promise<void> {
    if (managed.record.lastStatus !== "running" || !managed.session) return;
    try {
      await managed.session.interrupt();
    } catch (err) {
      this.deps.logger?.warn(
        { agentId: managed.record.id, err: err instanceof Error ? err.message : String(err) },
        "agent-manager: interrupting the running turn failed",
      );
    }
  }

  /**
   * Archive (soft delete) an agent and recursively cascade to its non-detached children
   * (architecture/agent-lifecycle.md § Archive). Interrupts a running turn first, snapshots the
   * session's persistence handle, sets `archivedAt`, normalizes `lastStatus` away from
   * running/initializing, notifies subscribers, closes/kills the runtime (which ends the turn, so
   * its `run()` and RPC settle), then archives each child whose parent label points at this agent.
   * Detached agents (no parent label) are never cascade-archived. Idempotent.
   */
  async archiveAgent(id: string): Promise<void> {
    const managed = this.agents.get(id);
    if (!managed || managed.record.archivedAt) return;

    await this.interruptRunningTurn(managed);

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

  private broadcastDeleted(agentId: string): void {
    const event: AgentDeletedBroadcast = { type: "agent_deleted", agentId };
    for (const cb of this.subscribers) cb(event);
  }

  /**
   * Hard-delete an agent: interrupts a running turn, closes/kills any live runtime, removes its
   * persisted record file from disk, drops it from memory, and recursively cascades to its
   * non-detached children — same cascade rule as `archiveAgent`. Unlike archive, there is no trace
   * left to resume from. The agent leaves memory BEFORE its session closes, so a turn that ends
   * because of the close finds no agent and writes nothing back. Returns true if the agent existed
   * (false = already gone, still idempotent/no-op).
   */
  async deleteAgent(id: string): Promise<boolean> {
    const managed = this.agents.get(id);
    if (!managed) return false;

    await this.interruptRunningTurn(managed);
    const session = managed.session;
    managed.session = null;
    this.agents.delete(id);
    if (session) {
      try {
        await session.close();
      } catch (err) {
        this.deps.logger?.warn(
          { agentId: id, err: err instanceof Error ? err.message : String(err) },
          "agent-manager: closing the deleted agent's session failed",
        );
      }
    }

    await this.delete(managed.record.cwd, id);
    this.broadcastDeleted(id);

    // Cascade to non-detached children (those whose parent label == this id) — snapshot first,
    // since deleting mutates `this.agents` out from under a live iteration.
    const children = this.listAll().filter(
      (child) => child.record.id !== id && child.parentAgentId === id,
    );
    for (const child of children) {
      await this.deleteAgent(child.record.id);
    }

    return true;
  }

  /**
   * Daemon shutdown: close every live session at once, each limited to `timeoutMs`. A session
   * whose `close()` throws, rejects or never resolves is logged and does not hold the others (or
   * the shutdown) back; a Pi session's own `close()` tree-kills its process before it resolves, so
   * a provider that hangs afterwards cannot keep the daemon alive. Records stay on disk — an agent
   * resumes its provider session at the next prompt — and each closed agent's `session` is cleared
   * so a second call is a no-op.
   */
  async closeAll(timeoutMs: number = AGENT_CLOSE_TIMEOUT_MS): Promise<void> {
    const live = this.listAll().filter((m) => m.session !== null);
    await Promise.all(
      live.map(async (managed) => {
        const session = managed.session;
        managed.session = null;
        if (!session) return;
        const { promise: timedOut, reject } = Promise.withResolvers<never>();
        const timer = setTimeout(
          () => reject(new Error(`session close timed out after ${timeoutMs} ms`)),
          timeoutMs,
        );
        try {
          await Promise.race([session.close(), timedOut]);
        } catch (err) {
          this.deps.logger?.warn(
            { agentId: managed.record.id, err: err instanceof Error ? err.message : String(err) },
            "agent-manager: closing agent session failed on shutdown",
          );
        } finally {
          clearTimeout(timer);
        }
      }),
    );
  }

  /**
   * Boot recovery: rehydrate persisted agents (runtime is NOT auto-resumed — records only), then run
   * the loop-recovery hook (`running` loops → `stopped`). Returns the number of agents reloaded.
   *
   * A record left `running`/`initializing` on disk (daemon killed mid-turn) describes a state
   * that requires a live session — but recovery attaches none (`this.wrap(record, null)`).
   * Left uncorrected this resurrects an impossible state: the UI shows a live "working"
   * indicator, `interrupt_agent` is a no-op (no session to interrupt), and a follow-up send
   * can't legally re-enter "running" from "running" (`ALLOWED_TRANSITIONS`). Normalize both back
   * to "idle" and persist it — the same normalization `archiveAgent` already does for archived
   * agents — so the record is truthful and resumable again.
   */
  async recover(): Promise<number> {
    const records = await this.loadAll();
    for (const record of records) {
      const reconciled =
        record.lastStatus === "running" || record.lastStatus === "initializing"
          ? { ...record, lastStatus: "idle" as const, updatedAt: this.now() }
          : record;
      if (reconciled !== record) await this.save(reconciled);
      this.agents.set(reconciled.id, this.wrap(reconciled, null));
    }
    return records.length;
  }
}
