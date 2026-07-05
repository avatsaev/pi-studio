// Open-project (home) screen model.
// app-navigation-screens.md § Open-project (host home)

import type { HostRuntimeSnapshot } from "../runtime/host-runtime.js";

export type OpenProjectTileId = "add-project" | "import-session" | "setup-providers" | "pair-device";

export type OpenProjectTile = {
  id: OpenProjectTileId;
  label: string;
  accent?: boolean;
  visible: boolean;
};

export type OpenProjectContext = {
  /** undefined for global /open-project; fixed server id for /h/[serverId]/open-project */
  serverId?: string;
  host?: HostRuntimeSnapshot;
};

export function isLocalHost(host: HostRuntimeSnapshot | undefined): boolean {
  if (!host) return false;
  if (host.profile.kind === "local-embedded") return true;
  if (host.profile.kind === "direct" && /^wss?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(host.profile.url)) return true;
  return false;
}

export function openProjectTiles(context: OpenProjectContext): OpenProjectTile[] {
  const local = isLocalHost(context.host);
  return [
    { id: "add-project", label: "Add a project", accent: true, visible: true },
    { id: "import-session", label: "Import session", visible: true },
    { id: "setup-providers", label: "Setup providers", visible: true },
    { id: "pair-device", label: "Pair device", visible: local },
  ];
}

export function visibleOpenProjectTiles(context: OpenProjectContext): OpenProjectTile[] {
  return openProjectTiles(context).filter((tile) => tile.visible);
}

export function shouldOpenSidebarOnOpenProjectMount(input: { isDesktop: boolean; isCompact: boolean }): boolean {
  return input.isDesktop && !input.isCompact;
}

export type TileLayout = "stacked" | "cards";

export function openProjectTileLayout(width: number): TileLayout {
  return width < 576 ? "stacked" : "cards";
}
