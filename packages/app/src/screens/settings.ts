// Settings information architecture view models.
// app-navigation-screens.md § Settings information architecture

import { DEFAULT_BINDINGS, type ShortcutSectionId } from "../shortcuts/registry.js";
import { formatCombo, type OsFamily } from "../ui/shortcut.js";
import type { HostRuntimeSnapshot } from "../runtime/host-runtime.js";
import {
  APP_SETTINGS_SECTIONS,
  DESKTOP_ONLY_SETTINGS_SECTIONS,
  HOST_SETTINGS_SECTIONS,
  normalizeAppSettingsSection,
  normalizeHostSettingsSection,
  type AppSettingsSection,
  type HostSettingsSection,
} from "../runtime/route-grammar.js";

export type SettingsView =
  | { kind: "root" }
  | { kind: "section"; section: AppSettingsSection }
  | { kind: "host"; serverId: string; section: HostSettingsSection }
  | { kind: "projects" }
  | { kind: "project"; projectKey: string };

export type SettingsLayout = {
  mode: "wide" | "compact";
  sidebarWidth?: number;
  navVerb: "replace" | "push";
  view: SettingsView;
};

export function resolveSettingsLayout(input: {
  path: string;
  width: number;
  isDesktop: boolean;
}): SettingsLayout {
  const compact = input.width < 768;
  const mode = compact ? "compact" : "wide";
  const navVerb = compact ? "push" : "replace";
  const view = resolveSettingsView(input.path, input.isDesktop, !compact);
  return { mode, navVerb, sidebarWidth: compact ? undefined : 320, view };
}

export function resolveSettingsView(path: string, isDesktop: boolean, wide: boolean): SettingsView {
  const [rawPath] = path.split("?");
  const parts = (rawPath ?? "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== "settings") return { kind: "root" };
  if (parts.length === 1) return wide ? { kind: "section", section: "general" } : { kind: "root" };
  if (parts[1] === "projects") {
    return parts[2] ? { kind: "project", projectKey: parts[2] } : { kind: "projects" };
  }
  if (parts[1] === "hosts" && parts[2]) {
    return { kind: "host", serverId: parts[2], section: normalizeHostSettingsSection(parts[3]) };
  }
  return { kind: "section", section: normalizeAppSettingsSection(parts[1], isDesktop) };
}

export type SettingsSidebarItem = {
  id: string;
  label: string;
  route: string;
  desktopOnly?: boolean;
};

const SECTION_LABELS: Record<AppSettingsSection, string> = {
  general: "General",
  daemon: "Daemon",
  appearance: "Appearance",
  shortcuts: "Shortcuts",
  integrations: "Integrations",
  permissions: "Permissions",
  diagnostics: "Diagnostics",
  about: "About",
};

const HOST_SECTION_LABELS: Record<HostSettingsSection, string> = {
  connections: "Connections",
  agents: "Agents",
  workspaces: "Workspaces",
  providers: "Providers",
  host: "Host",
};

export function appSettingsItems(isDesktop: boolean): SettingsSidebarItem[] {
  return APP_SETTINGS_SECTIONS
    .filter((section) => isDesktop || !DESKTOP_ONLY_SETTINGS_SECTIONS.includes(section))
    .map((section) => ({
      id: section,
      label: SECTION_LABELS[section],
      route: `/settings/${section}`,
      desktopOnly: DESKTOP_ONLY_SETTINGS_SECTIONS.includes(section) || undefined,
    }));
}

export type HostPickerRow =
  | { kind: "host"; serverId: string; label: string; local: boolean }
  | { kind: "add-host"; label: "Add host" };

export function hostPickerRows(hosts: readonly HostRuntimeSnapshot[]): HostPickerRow[] {
  const sorted = [...hosts].sort((a, b) => {
    const aLocal = a.profile.kind === "local-embedded" ? 0 : 1;
    const bLocal = b.profile.kind === "local-embedded" ? 0 : 1;
    return aLocal - bLocal || a.profile.createdAtMs - b.profile.createdAtMs;
  });
  return [
    ...sorted.map((h): HostPickerRow => ({
      kind: "host",
      serverId: h.serverId ?? h.profile.serverId ?? h.profile.id,
      label: h.profile.label,
      local: h.profile.kind === "local-embedded",
    })),
    { kind: "add-host", label: "Add host" },
  ];
}

export function hostSettingsItems(serverId: string, host: HostRuntimeSnapshot | undefined): SettingsSidebarItem[] {
  const base = HOST_SETTINGS_SECTIONS.map((section) => ({
    id: section,
    label: HOST_SECTION_LABELS[section],
    route: `/settings/hosts/${encodeURIComponent(serverId)}/${section}`,
  }));
  if (host?.features.providerUsageList) {
    return base.map((item) => item.id === "providers" ? { ...item, label: "Providers + Usage" } : item);
  }
  return base;
}

export type DaemonModeToggleResult =
  | { kind: "toggle"; nextMode: "embedded" | "remote-only"; requiresConfirmation: false }
  | { kind: "toggle"; nextMode: "remote-only"; requiresConfirmation: true; message: string };

export function daemonModeToggle(input: {
  currentMode: "embedded" | "remote-only";
  embeddedIsOnlyHost: boolean;
}): DaemonModeToggleResult {
  const nextMode = input.currentMode === "embedded" ? "remote-only" : "embedded";
  if (nextMode === "remote-only" && input.embeddedIsOnlyHost) {
    return {
      kind: "toggle",
      nextMode,
      requiresConfirmation: true,
      message: "You will see Welcome next launch until you add a host.",
    };
  }
  return { kind: "toggle", nextMode, requiresConfirmation: false };
}

export type PermissionState = "granted" | "denied" | "prompt" | "not-granted" | "unavailable" | "unknown";

export function permissionAction(state: PermissionState): "none" | "request" | "open-settings" {
  if (state === "granted" || state === "unavailable") return "none";
  if (state === "denied" || state === "not-granted") return "open-settings";
  return "request";
}

export function shortcutHelpRows(os: OsFamily): Array<{ section: ShortcutSectionId; id: string; combo: string }> {
  return DEFAULT_BINDINGS.map((binding) => ({
    section: binding.section,
    id: binding.id,
    combo: formatCombo(os === "macos" ? binding.mac : binding.nonMac, os),
  }));
}

export function appDiagnosticReport(input: {
  appVersion: string;
  hosts: readonly HostRuntimeSnapshot[];
  route: string;
}): string {
  const hostLines = input.hosts.map((h) => `${h.profile.label}:${h.status}:${h.serverId ?? h.profile.serverId ?? "unknown"}`);
  return [`Pi-Studio diagnostic report`, `version=${input.appVersion}`, `route=${input.route}`, `hosts=${hostLines.join(",")}`].join("\n");
}
