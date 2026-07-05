// Startup boot resolver + h/* route guard.
// app-navigation-screens.md § Boot / startup resolver, § Route map guard rules

import { routes } from "./route-grammar.js";
import type { HostRuntimeSnapshot } from "./host-runtime.js";

export type LastWorkspaceSelection = {
  serverId: string;
  workspaceId: string;
};

export type BootResolverInput = {
  storeReady: boolean;
  gaveUp: boolean;
  splashError?: { message: string; logPath?: string };
  lastWorkspace?: LastWorkspaceSelection;
  hosts: readonly HostRuntimeSnapshot[];
};

export type BootResolverResult =
  | { kind: "splash" }
  | { kind: "splash-error"; message: string; logPath?: string }
  | { kind: "redirect"; to: string };

export function resolveBootRoute(input: BootResolverInput): BootResolverResult {
  if (input.splashError) {
    return { kind: "splash-error", message: input.splashError.message, logPath: input.splashError.logPath };
  }

  const onlineHosts = input.hosts.filter((h) => h.status === "online");

  if (input.lastWorkspace) {
    const host = onlineHosts.find((h) => h.serverId === input.lastWorkspace?.serverId || h.profile.serverId === input.lastWorkspace?.serverId);
    if (host) {
      return { kind: "redirect", to: routes.workspace(input.lastWorkspace.serverId, input.lastWorkspace.workspaceId) };
    }
  }

  const firstOnline = onlineHosts.sort((a, b) => a.profile.createdAtMs - b.profile.createdAtMs)[0];
  if (firstOnline) {
    const serverId = firstOnline.serverId ?? firstOnline.profile.serverId;
    if (serverId) return { kind: "redirect", to: routes.hostRoot(serverId) };
  }

  if (input.gaveUp) return { kind: "redirect", to: routes.welcome() };
  return { kind: "splash" };
}

export type HostRouteGuardInput = {
  storeReady: boolean;
  serverId: string;
  hosts: readonly HostRuntimeSnapshot[];
};

export type HostRouteGuardResult =
  | { kind: "splash" }
  | { kind: "allow" }
  | { kind: "redirect"; to: string };

export function guardHostRoute(input: HostRouteGuardInput): HostRouteGuardResult {
  if (!input.storeReady) return { kind: "splash" };
  const known = input.hosts.find((h) => h.serverId === input.serverId || h.profile.serverId === input.serverId);
  if (known) return { kind: "allow" };

  const first = [...input.hosts].sort((a, b) => a.profile.createdAtMs - b.profile.createdAtMs)[0];
  const serverId = first?.serverId ?? first?.profile.serverId;
  if (serverId) return { kind: "redirect", to: routes.hostOpenProject(serverId) };
  return { kind: "redirect", to: routes.welcome() };
}

export class StoreReadyLatch {
  private ready = false;

  get value(): boolean {
    return this.ready;
  }

  update(input: { onlineHost: boolean; splashError: boolean; gaveUp: boolean }): boolean {
    if (this.ready) return true;
    if (input.onlineHost || input.splashError || input.gaveUp) this.ready = true;
    return this.ready;
  }
}
