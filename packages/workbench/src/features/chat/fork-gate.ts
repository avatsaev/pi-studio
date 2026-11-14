/**
 * Fork-affordance visibility gate (sprint-072/task-002) — a single pure predicate deciding
 * whether ANY row in a session can offer a fork button right now (visual spec § 03 "When the
 * affordance exists"). Row-level confirmation (`fork-correlation.ts`'s `isConfirmedUserRow`) is
 * layered on top of this by the caller (`use-fork-action.ts`) — this gate only answers the
 * SESSION-level half: capability, turn state, and process existence.
 */
export interface ForkGateInput {
  /** `server_info.features.forkTimelineSync` (`protocol/src/client-capabilities.ts`). */
  forkTimelineSync: boolean;
  /** `session.status === "running"` — the same signal the composer's busy state consumes; Pi
   * tears down the runtime on fork, so it must never be offered mid-turn. */
  running: boolean;
  /**
   * `session.agentId` — `null` for a deferred draft with no live process
   * (`stores/materialize.ts`). A materialized-but-never-sent draft can in practice never have a
   * CONFIRMED user row to attach a button to (the very first confirmed row implies a live
   * process already produced the `user_message` broadcast that confirmed it), but this is
   * checked explicitly rather than relied on as a structural side effect, since the acceptance
   * criterion is about observable button absence on such a session, not an inference from a
   * different invariant.
   */
  agentId: string | null;
}

/** True iff the fork affordance can offer ANY row in this session a fork button right now. */
export function canOfferFork(input: ForkGateInput): boolean {
  return input.forkTimelineSync && !input.running && input.agentId !== null;
}
