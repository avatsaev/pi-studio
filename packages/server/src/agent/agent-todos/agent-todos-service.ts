import { isDeepStrictEqual } from "node:util";

import type { AgentTodosSnapshot } from "@av-pi-studio/protocol";

import type { Logger } from "../../logging/logger.js";
import type { Session } from "../../ws/session.js";
import type { ManagedAgent } from "../agent-manager.js";
import type {
  AgentClient,
  AgentSession,
  AgentTodoList,
  PersistenceHandle,
  Unsubscribe,
} from "../provider-contract.js";

/**
 * Retains each agent's todo list, sequences it and broadcasts changes (features/agent-todos.md
 * § Daemon service). Provider-neutral: it only ever sees `AgentTodoList`s from the optional
 * `onTodos`/`readTodos` members, never an extension's own shape (root AGENTS.md invariant 3).
 *
 * Decisions that each prevent a concrete defect:
 *  - **Dedupe before `seq`.** Pi announces one `todo` call twice (`entry_appended`, then
 *    `tool_execution_end`), and a turn usually ends with the list unchanged. An equal list neither
 *    bumps `seq` nor broadcasts, so a client never repaints for a no-op.
 *  - **The service owns every reconcile trigger.** `session.subscribe` is multi-subscriber and the
 *    stream already carries the settle signal (`turn_*` terminals, mapped from Pi's
 *    `agent_settled`) and `compaction` completed, so no provider needs a settle hook. Fork is an
 *    explicit `reconcile()` call because `agent_timeline_reset` is not a stream event.
 *  - **`seq` is never reset by a sweep.** Dropping the counter would restart a re-attached agent at
 *    `seq: 1`, which every connected client drops as stale. It only restarts with the process,
 *    which clients handle by resetting on reconnect.
 *  - **Reads never throw to callers and logs never carry task text.** A failed read is a `warn`
 *    with the agent id and the error message, then an empty list (`list`) or no change (reconcile).
 */

/** `AgentSession.readTodos`/`onTodos` present: the only sessions the service watches. */
type TodoSession = AgentSession & Required<Pick<AgentSession, "onTodos" | "readTodos">>;

interface Entry {
  /** Last `seq` handed out; 0 until the first non-empty list. Survives `sweep`. */
  seq: number;
  list: AgentTodoList;
  /** True once `list` reflects a real read or emission; false forces the next `list()` to read. */
  loaded: boolean;
  /** Subscriptions on the currently attached session (todos channel + stream). */
  unsubscribes: Unsubscribe[];
}

export interface AgentTodosServiceDeps {
  broadcast: (sessions: Iterable<Session>, message: unknown) => void;
  getActiveSessions: () => Iterable<Session>;
  /** The agent record plus its live session, if any (`AgentManager.get`). */
  getAgent: (agentId: string) => ManagedAgent | undefined;
  resolveClient: (provider: string) => AgentClient;
  logger?: Logger;
}

export type AgentTodosListResult =
  | { ok: true; snapshot: AgentTodosSnapshot }
  | { ok: false; error: "not_found" };

const EMPTY: AgentTodoList = { tasks: [], truncated: false };

function hasTodoMembers(session: AgentSession): session is TodoSession {
  return typeof session.onTodos === "function" && typeof session.readTodos === "function";
}

export class AgentTodosService {
  private readonly broadcastFn: AgentTodosServiceDeps["broadcast"];
  private readonly getActiveSessions: AgentTodosServiceDeps["getActiveSessions"];
  private readonly getAgent: AgentTodosServiceDeps["getAgent"];
  private readonly resolveClient: AgentTodosServiceDeps["resolveClient"];
  private readonly logger: Logger | undefined;

  private readonly entries = new Map<string, Entry>();

  constructor(deps: AgentTodosServiceDeps) {
    this.broadcastFn = deps.broadcast;
    this.getActiveSessions = deps.getActiveSessions;
    this.getAgent = deps.getAgent;
    this.resolveClient = deps.resolveClient;
    this.logger = deps.logger;
  }

  /**
   * `AgentManager.onSessionAttached` hook. Drops the previous session's subscriptions (a respawn
   * leaves the old process's emissions meaningless), then watches the new one and seeds from its
   * session file. The retained list is NOT cleared first: if the seed is equal nothing is
   * broadcast, so a respawn never flickers the panel.
   */
  attach(agentId: string, session: AgentSession): void {
    this.unsubscribe(agentId);
    if (!hasTodoMembers(session)) return;

    const entry = this.entry(agentId);
    entry.unsubscribes.push(
      session.onTodos((list) => this.publish(agentId, list, true)),
      session.subscribe((event) => {
        if (
          event.kind === "turn_completed" ||
          event.kind === "turn_failed" ||
          event.kind === "turn_canceled" ||
          (event.kind === "compaction" && event.phase === "completed")
        ) {
          this.reconcile(agentId);
        }
      }),
    );
    this.read(agentId, () => session.readTodos(), true);
  }

  /**
   * Re-derive from the session's CURRENT file and publish the difference (settled turn,
   * compaction, fork/rebind). With no live session there is nothing to compare against: drop the
   * cache so the next `list` reads the file again.
   */
  reconcile(agentId: string): void {
    const session = this.getAgent(agentId)?.session;
    if (session && hasTodoMembers(session)) {
      this.read(agentId, () => session.readTodos(), true);
      return;
    }
    const entry = this.entries.get(agentId);
    if (entry) entry.loaded = false;
  }

  /**
   * The current snapshot for any known agent, live or process-less. Never an error for an
   * unreadable session file: that is an empty snapshot plus a `warn`.
   */
  list(agentId: string): AgentTodosListResult {
    const managed = this.getAgent(agentId);
    if (!managed) return { ok: false, error: "not_found" };

    const existing = this.entries.get(agentId);
    if (!existing?.loaded) {
      const session = managed.session;
      if (session && hasTodoMembers(session)) {
        this.read(agentId, () => session.readTodos(), false);
      } else {
        const handle = managed.record.persistence as PersistenceHandle | undefined;
        const client = this.resolveClient(managed.record.provider);
        if (handle && client.readTodos) {
          this.read(agentId, () => client.readTodos!(handle), false);
        }
      }
    }
    return { ok: true, snapshot: this.snapshotOf(agentId) };
  }

  /**
   * Archive / delete / any terminal event for the agent. Broadcasts an empty snapshot (with `seq`
   * + 1) only if there was a list to clear, and keeps the counter so a later attach continues
   * upward.
   */
  sweep(agentId: string): void {
    this.unsubscribe(agentId);
    const entry = this.entries.get(agentId);
    if (!entry) return;
    this.publish(agentId, EMPTY, true);
    entry.loaded = false;
  }

  private entry(agentId: string): Entry {
    let entry = this.entries.get(agentId);
    if (!entry) {
      entry = { seq: 0, list: EMPTY, loaded: false, unsubscribes: [] };
      this.entries.set(agentId, entry);
    }
    return entry;
  }

  private unsubscribe(agentId: string): void {
    const entry = this.entries.get(agentId);
    if (!entry) return;
    for (const off of entry.unsubscribes) off();
    entry.unsubscribes = [];
  }

  /**
   * Run a provider read; a throw is logged (agent id + message, no task text) and changes nothing,
   * leaving `loaded` as it was so the next `list` retries a transient failure.
   */
  private read(agentId: string, source: () => AgentTodoList, broadcast: boolean): void {
    let list: AgentTodoList;
    try {
      list = source();
    } catch (err) {
      this.logger?.warn(
        { agentId, err: err instanceof Error ? err.message : String(err) },
        "agent-todos: reading the session todo list failed",
      );
      return;
    }
    this.publish(agentId, list, broadcast);
  }

  /**
   * Make `list` the agent's current list. An equal list is a no-op; otherwise `seq` advances and,
   * when `broadcast` is set, every active session hears it. `broadcast: false` is the first load
   * behind a `list` RPC: the answer carries the new `seq`, nobody else needs it.
   */
  private publish(agentId: string, list: AgentTodoList, broadcast: boolean): void {
    const entry = this.entry(agentId);
    entry.loaded = true;
    if (isDeepStrictEqual(entry.list, list)) return;
    entry.list = list;
    entry.seq += 1;
    if (!broadcast) return;
    this.broadcastFn(this.getActiveSessions(), {
      type: "session",
      message: { type: "agent_todos_update", snapshot: this.snapshotOf(agentId) },
    });
  }

  private snapshotOf(agentId: string): AgentTodosSnapshot {
    const entry = this.entries.get(agentId);
    const seq = entry?.seq ?? 0;
    const list = entry?.list ?? EMPTY;
    return {
      agentId,
      seq,
      tasks: list.tasks,
      ...(list.truncated ? { truncated: true } : {}),
    };
  }
}
