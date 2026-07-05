// Welcome/onboarding screen model.
// app-navigation-screens.md § Onboarding & pairing

import type { HostRuntimeSnapshot } from "../runtime/host-runtime.js";
import { routes } from "../runtime/route-grammar.js";

export type OnboardingPlatform = "web" | "native" | "desktop";

export type WelcomeActionId =
  | "use-this-computer"
  | "scan-qr"
  | "direct-connection"
  | "paste-pairing-link";

export type WelcomeAction = {
  id: WelcomeActionId;
  label: string;
  primary: boolean;
};

export function welcomeActions(platform: OnboardingPlatform): WelcomeAction[] {
  if (platform === "desktop") {
    return [
      { id: "use-this-computer", label: "Use this computer", primary: true },
      { id: "direct-connection", label: "Direct connection", primary: false },
      { id: "paste-pairing-link", label: "Paste pairing link", primary: false },
    ];
  }
  if (platform === "native") {
    return [
      { id: "scan-qr", label: "Scan QR code", primary: true },
      { id: "direct-connection", label: "Direct connection", primary: false },
      { id: "paste-pairing-link", label: "Paste pairing link", primary: false },
    ];
  }
  return [
    { id: "direct-connection", label: "Direct connection", primary: true },
    { id: "paste-pairing-link", label: "Paste pairing link", primary: false },
  ];
}

export function welcomeAutoRedirect(hosts: readonly HostRuntimeSnapshot[]): string | null {
  const online = [...hosts]
    .filter((h) => h.status === "online")
    .sort((a, b) => a.profile.createdAtMs - b.profile.createdAtMs)[0];
  const serverId = online?.serverId ?? online?.profile.serverId;
  return serverId ? routes.hostRoot(serverId) : null;
}

export type DesktopDaemonBridge = {
  setDaemonMode(mode: "embedded" | "remote-only"): Promise<void> | void;
  startLocalDaemon(): Promise<{ serverId: string }>;
};

export async function useThisComputer(input: {
  bridge: DesktopDaemonBridge;
}): Promise<{ route: string; serverId: string }> {
  await input.bridge.setDaemonMode("embedded");
  const { serverId } = await input.bridge.startLocalDaemon();
  return { serverId, route: routes.hostRoot(serverId) };
}
