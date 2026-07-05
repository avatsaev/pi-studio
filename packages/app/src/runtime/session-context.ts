// Session context contracts (framework-agnostic).
// client-app-runtime.md § App runtime concepts

import type { ConnectedDaemonClient, HostRuntimeSnapshot } from "./host-runtime.js";

export type SessionContextValue = {
  serverId: string;
  host: HostRuntimeSnapshot;
  client: ConnectedDaemonClient;
};

export function createSessionContextValue(host: HostRuntimeSnapshot): SessionContextValue | null {
  const serverId = host.serverId ?? host.profile.serverId;
  if (!serverId || !host.client || host.status !== "online") return null;
  return { serverId, host, client: host.client };
}
