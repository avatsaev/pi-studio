/**
 * A scripted `HostUpdates` for tests: the state is whatever `set` last published, and every
 * command is recorded in `calls`. Hand it to `createTestHost({ updates })`.
 */

import { type AppUpdateState, type HostUpdates } from "../host/types.js";

export interface TestUpdates extends HostUpdates {
  /** The commands run so far, in order. */
  calls: ("check" | "install" | "restart")[];
  /** Publish a new state to every subscriber. */
  set(state: AppUpdateState): void;
  listenerCount(): number;
}

export function createTestUpdates(initial: AppUpdateState = { state: "idle" }): TestUpdates {
  let state = initial;
  const listeners = new Set<() => void>();
  const calls: TestUpdates["calls"] = [];
  return {
    calls,
    set: (next) => {
      state = next;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
    current: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    check: async () => void calls.push("check"),
    install: async () => void calls.push("install"),
    restart: async () => void calls.push("restart"),
  };
}
