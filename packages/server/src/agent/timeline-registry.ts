import { AgentTimelineStore, type TimelineRow } from "./timeline-store.js";

/**
 * The in-memory timeline store of every agent a daemon holds history for, keyed by agent id. One
 * registry per `AgentManager` (`manager.timelines`): the manager evicts an agent's store when the
 * agent is archived or deleted, so a store never outlives the agent's usefulness. A fetch for an
 * archived agent rebuilds its store from the provider's durable history (`ensureTimelineSeeded`).
 */
export class TimelineRegistry {
  private readonly stores = new Map<string, AgentTimelineStore>();

  /** Stores currently held. */
  get size(): number {
    return this.stores.size;
  }

  get(agentId: string): AgentTimelineStore | undefined {
    return this.stores.get(agentId);
  }

  /** The existing store, or a new empty one. */
  getOrCreate(agentId: string, now?: () => string): AgentTimelineStore {
    let store = this.stores.get(agentId);
    if (!store) {
      store = new AgentTimelineStore({ now });
      this.stores.set(agentId, store);
    }
    return store;
  }

  /** Install a store holding `rows` for an agent that has none; never overwrites an existing one. */
  seed(agentId: string, rows: TimelineRow[], now?: () => string): void {
    if (this.stores.has(agentId)) return;
    this.stores.set(agentId, new AgentTimelineStore({ initialRows: rows, now }));
  }

  /**
   * Replace `agentId`'s rows with `rows` (fork resync), creating the store if there is none. `rows`
   * may be empty (a fork to before the first user message).
   */
  reset(agentId: string, rows: TimelineRow[]): void {
    this.getOrCreate(agentId).replaceRows(rows);
  }

  /**
   * Drop `agentId`'s store. A holder of the store object (a turn still ending) keeps appending to
   * that object, but nothing registers it again.
   */
  evict(agentId: string): void {
    this.stores.delete(agentId);
  }
}
