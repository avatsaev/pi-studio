/**
 * Adapters — pure functions mapping single-daemon ConnectionProvider state and
 * the session store's AgentEntry records into the shapes the real, already-built
 * nav chrome components (LeftSidebar, CommandCenter) expect.
 *
 * Pi-Studio's data model supports multiple hosts (see runtime/host-runtime.ts),
 * but the app currently connects to exactly one daemon at a time via
 * ConnectionProvider. These adapters project that single connection into a
 * one-element `HostRuntimeSnapshot[]` so the multi-host-shaped components can
 * be reused as-is, without re-implementing them for a "single host" case.
 *
 * clean-room-scope/features/app-navigation-screens.md § Left sidebar, § Command center
 */

import type { AppConnectionStatus } from "../providers/ConnectionProvider.js";
import type { ConnectionStatus, HostRuntimeSnapshot } from "../runtime/host-runtime.js";
import type { AgentEntry } from "../store/session-store.js";
import type { CommandCenterAgent } from "../screens/command-center.js";
import type { AgentStatus } from "@av-pi-studio/protocol";

const LOCAL_HOST_PROFILE_ID = "local-daemon";

/** Maps the app-level connection status enum to the host-runtime status enum. */
export function toHostConnectionStatus(status: AppConnectionStatus): ConnectionStatus {
  switch (status) {
    case "no-hosts":
      return "idle";
    case "connecting":
      return "connecting";
    case "connected":
      return "online";
    case "reconnecting":
      return "connecting";
    case "error":
      return "error";
  }
}

export interface ConnectionSnapshotInput {
  status: AppConnectionStatus;
  serverId: string | null;
  address: string | null;
}

/**
 * Builds the single-element `hosts` array LeftSidebar/CommandCenter expect from
 * the app's single ConnectionProvider connection. Returns an empty array when
 * no daemon address is configured yet ("no-hosts") — there is no host to show.
 */
export function connectionToHostSnapshots(input: ConnectionSnapshotInput): HostRuntimeSnapshot[] {
  if (input.status === "no-hosts" || !input.address) return [];

  const connectionStatus = toHostConnectionStatus(input.status);
  const snapshot: HostRuntimeSnapshot = {
    profile: {
      id: LOCAL_HOST_PROFILE_ID,
      label: "Pi-Studio",
      kind: "direct",
      url: input.address,
      serverId: input.serverId ?? undefined,
      createdAtMs: 0,
    },
    status: connectionStatus,
    serverId: input.serverId ?? undefined,
    features: {},
    reconnectAttempt: 0,
    client:
      connectionStatus === "online" && input.serverId
        ? {
            serverInfo: { serverId: input.serverId, features: {} },
            onDrop: () => () => {},
          }
        : undefined,
  };

  return [snapshot];
}

/** Convenience: the single active host, or undefined when disconnected. */
export function activeHostSnapshot(input: ConnectionSnapshotInput): HostRuntimeSnapshot | undefined {
  return connectionToHostSnapshots(input)[0];
}

/**
 * Maps the daemon's `AgentStatus` enum (initializing/idle/running/error/closed)
 * to the CommandCenterAgent status enum (idle/running/waiting/finished/error/
 * queued/archived). There is no daemon-side "waiting"/"archived" concept wired
 * yet (TODO(verify): revisit once archive/soft-delete + tool-permission-wait
 * states are surfaced client-side) — those map to their closest analogue for now.
 */
export function toCommandCenterStatus(status: AgentStatus): CommandCenterAgent["status"] {
  switch (status) {
    case "initializing":
      return "queued";
    case "idle":
      return "idle";
    case "running":
      return "running";
    case "error":
      return "error";
    case "closed":
      return "finished";
  }
}

/** Counts permission requests still awaiting a decision. */
export function pendingPermissionCount(agent: AgentEntry): number {
  return Object.values(agent.permissions).filter((p) => p.state === "pending").length;
}

/**
 * Maps session-store `AgentEntry` records into `CommandCenterAgent` rows.
 * `serverId` defaults to the connection's serverId (single-host today).
 */
export function toCommandCenterAgents(
  agents: readonly AgentEntry[],
  serverId: string | null,
): CommandCenterAgent[] {
  return agents.map((agent) => {
    const pending = pendingPermissionCount(agent);
    return {
      serverId: serverId ?? LOCAL_HOST_PROFILE_ID,
      agentId: agent.agentId,
      title: agent.title,
      cwd: agent.cwd,
      status: toCommandCenterStatus(agent.status),
      requiresAttention: pending > 0,
      pendingPermissionCount: pending,
      lastActivityMs: agent.lastActivity ?? 0,
    };
  });
}
