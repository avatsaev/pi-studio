/**
 * Connection store: zustand store wrapping the host runtime controller.
 * Bridges the sprint-013 host-runtime model into React-consumable state.
 */

import { type HostRuntimeSnapshot, type ConnectionStatus } from "../runtime/host-runtime.js";
import { type SessionContextValue, createSessionContextValue } from "../runtime/session-context.js";

// ---------------------------------------------------------------------------
// Connection state shape
// ---------------------------------------------------------------------------

export interface ConnectionState {
  /** All known host snapshots by serverId. */
  hosts: Record<string, HostRuntimeSnapshot>;
  /** Currently active serverId (route-driven). */
  activeServerId: string | null;
  /** Convenience: session context for the active host (null if not connected). */
  session: SessionContextValue | null;
}

export type ConnectionAction =
  | { type: "set_host"; snapshot: HostRuntimeSnapshot }
  | { type: "remove_host"; serverId: string }
  | { type: "set_active"; serverId: string | null };

export function connectionReducer(
  state: ConnectionState,
  action: ConnectionAction,
): ConnectionState {
  switch (action.type) {
    case "set_host": {
      const id = action.snapshot.serverId ?? action.snapshot.profile.serverId;
      if (!id) return state;
      const hosts = { ...state.hosts, [id]: action.snapshot };
      const session =
        state.activeServerId && hosts[state.activeServerId]
          ? createSessionContextValue(hosts[state.activeServerId]!)
          : state.session;
      return { ...state, hosts, session };
    }
    case "remove_host": {
      const { [action.serverId]: _, ...hosts } = state.hosts;
      const activeServerId =
        state.activeServerId === action.serverId ? null : state.activeServerId;
      return { ...state, hosts, activeServerId, session: null };
    }
    case "set_active": {
      const host = action.serverId ? state.hosts[action.serverId] : undefined;
      const session = host ? createSessionContextValue(host) : null;
      return { ...state, activeServerId: action.serverId, session };
    }
  }
}

export const INITIAL_CONNECTION_STATE: ConnectionState = {
  hosts: {},
  activeServerId: null,
  session: null,
};
