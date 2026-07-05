// Root provider stack + shell/chrome gating contracts.
// app-navigation-screens.md § Routing technology, § Global navigation shell

import { parseRoute } from "./route-grammar.js";
import type { HostRuntimeSnapshot } from "./host-runtime.js";

export const ROOT_PROVIDER_STACK = [
  "gesture-root",
  "query-client",
  "safe-area",
  "keyboard",
  "portal-provider",
  "bottom-sheet-provider",
  "host-runtime-bootstrap",
  "push-notification-router",
  "toast-host",
  "voice-provider",
  "desktop-window-control-sync",
  "deep-link-listener",
  "per-host-session-managers",
  "app-shell",
] as const;

export type RootProviderName = (typeof ROOT_PROVIDER_STACK)[number];

export function shouldShowSidebar(path: string, storeReady: boolean, hosts: readonly HostRuntimeSnapshot[]): boolean {
  if (!storeReady) return false;
  const route = parseRoute(path);
  const serverId = "serverId" in route ? route.serverId : undefined;
  if (!serverId) return false;
  return hosts.some((h) => h.serverId === serverId || h.profile.serverId === serverId);
}

export function activeHostForPath(path: string, hosts: readonly HostRuntimeSnapshot[]): HostRuntimeSnapshot | undefined {
  const route = parseRoute(path);
  const serverId = "serverId" in route ? route.serverId : undefined;
  if (serverId) return hosts.find((h) => h.serverId === serverId || h.profile.serverId === serverId);
  return [...hosts].sort((a, b) => a.profile.createdAtMs - b.profile.createdAtMs)[0];
}

export function translateRouteToHost(path: string, newServerId: string): string {
  const route = parseRoute(path);
  switch (route.kind) {
    case "settings":
      return `/settings/hosts/${encodeURIComponent(newServerId)}/connections`;
    case "sessions":
      return "/sessions";
    case "open-project":
      return `/h/${encodeURIComponent(newServerId)}/open-project`;
    case "workspace":
      return `/h/${encodeURIComponent(newServerId)}/workspace/${encodeURIComponent(route.workspaceId)}`;
    case "agent":
      return `/h/${encodeURIComponent(newServerId)}/agent/${encodeURIComponent(route.agentId)}`;
    default:
      return `/h/${encodeURIComponent(newServerId)}`;
  }
}

export const ALWAYS_MOUNTED_OVERLAY_SINGLETONS = [
  "floating-panel-portal-host",
  "download-toast",
  "command-palette",
  "project-picker-modal",
  "provider-settings-host",
  "workspace-setup-dialog",
  "keyboard-shortcuts-dialog",
  "quitting-overlay",
] as const;
