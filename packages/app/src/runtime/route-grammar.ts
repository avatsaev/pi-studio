// Shared route grammar builders/parsers.
// app-navigation-screens.md § Route map

export type AppSettingsSection =
  | "general"
  | "daemon"
  | "appearance"
  | "shortcuts"
  | "integrations"
  | "permissions"
  | "diagnostics"
  | "about";

export type HostSettingsSection = "connections" | "agents" | "workspaces" | "providers" | "host";

export const APP_SETTINGS_SECTIONS: readonly AppSettingsSection[] = [
  "general",
  "daemon",
  "appearance",
  "shortcuts",
  "integrations",
  "permissions",
  "diagnostics",
  "about",
];

export const DESKTOP_ONLY_SETTINGS_SECTIONS: readonly AppSettingsSection[] = [
  "daemon",
  "shortcuts",
  "integrations",
  "permissions",
];

export const HOST_SETTINGS_SECTIONS: readonly HostSettingsSection[] = [
  "connections",
  "agents",
  "workspaces",
  "providers",
  "host",
];

export type WorkspaceOpenIntent =
  | { kind: "agent"; id: string }
  | { kind: "terminal"; id: string }
  | { kind: "file"; path: string }
  | { kind: "draft"; id: string }
  | { kind: "setup"; workspaceId: string };

export function normalizeAppSettingsSection(slug: string | undefined, isDesktop: boolean): AppSettingsSection {
  const value = slug as AppSettingsSection | undefined;
  if (!value || !APP_SETTINGS_SECTIONS.includes(value)) return "general";
  if (!isDesktop && DESKTOP_ONLY_SETTINGS_SECTIONS.includes(value)) return "general";
  return value;
}

export function normalizeHostSettingsSection(slug: string | undefined): HostSettingsSection {
  if (slug === "orchestration") return "agents";
  if (slug === "daemon") return "host";
  const value = slug as HostSettingsSection | undefined;
  return value && HOST_SETTINGS_SECTIONS.includes(value) ? value : "connections";
}

export function encodeSegment(segment: string): string {
  return encodeURIComponent(segment);
}

export function decodeSegment(segment: string): string {
  return decodeURIComponent(segment);
}

const URL_SAFE_RE = /^[A-Za-z0-9._~-]+$/;

export function encodeWorkspaceId(workspaceId: string): string {
  if (URL_SAFE_RE.test(workspaceId)) return encodeSegment(workspaceId);
  return `b64_${base64UrlEncodeUtf8(workspaceId)}`;
}

export function decodeWorkspaceId(segment: string): string {
  const decoded = decodeSegment(segment);
  if (!decoded.startsWith("b64_")) return decoded;
  return base64UrlDecodeUtf8(decoded.slice(4));
}

export function buildOpenIntent(intent: WorkspaceOpenIntent): string {
  switch (intent.kind) {
    case "agent":
      return `agent:${intent.id}`;
    case "terminal":
      return `terminal:${intent.id}`;
    case "file":
      return `file:${base64UrlEncodeUtf8(intent.path)}`;
    case "draft":
      return `draft:${intent.id}`;
    case "setup":
      return `setup:${intent.workspaceId}`;
  }
}

export function parseOpenIntent(value: string | undefined): WorkspaceOpenIntent | null {
  if (!value) return null;
  const idx = value.indexOf(":");
  if (idx <= 0) return null;
  const kind = value.slice(0, idx);
  const payload = value.slice(idx + 1);
  if (payload === "") return null;
  switch (kind) {
    case "agent":
      return { kind: "agent", id: payload };
    case "terminal":
      return { kind: "terminal", id: payload };
    case "file":
      return { kind: "file", path: base64UrlDecodeUtf8(payload) };
    case "draft":
      return { kind: "draft", id: payload };
    case "setup":
      return { kind: "setup", workspaceId: payload };
    default:
      return null;
  }
}

export const routes = {
  root: () => "/",
  welcome: () => "/welcome",
  pairScan: (source: "settings" | "onboarding" = "onboarding") => `/pair-scan?source=${source}`,
  openProject: () => "/open-project",
  sessions: () => "/sessions",
  schedules: () => "/schedules",
  newWorkspace: (query: NewWorkspaceQuery = {}) => `/new${buildQuery(query)}`,
  hostRoot: (serverId: string) => `/h/${encodeSegment(serverId)}`,
  hostOpenProject: (serverId: string) => `/h/${encodeSegment(serverId)}/open-project`,
  legacyHostSessions: (serverId: string) => `/h/${encodeSegment(serverId)}/sessions`,
  agent: (serverId: string, agentId: string) => `/h/${encodeSegment(serverId)}/agent/${encodeSegment(agentId)}`,
  workspace: (serverId: string, workspaceId: string, intent?: WorkspaceOpenIntent) => {
    const base = `/h/${encodeSegment(serverId)}/workspace/${encodeWorkspaceId(workspaceId)}`;
    return intent ? `${base}?open=${encodeURIComponent(buildOpenIntent(intent))}` : base;
  },
  settings: () => "/settings",
  settingsSection: (section: AppSettingsSection) => `/settings/${section}`,
  projects: () => "/settings/projects",
  projectSettings: (projectKey: string) => `/settings/projects/${encodeSegment(projectKey)}`,
  hostSettingsRoot: (serverId: string) => `/settings/hosts/${encodeSegment(serverId)}`,
  hostSettingsSection: (serverId: string, section: HostSettingsSection) =>
    `/settings/hosts/${encodeSegment(serverId)}/${section}`,
} as const;

export type NewWorkspaceQuery = {
  serverId?: string;
  dir?: string;
  name?: string;
  projectId?: string;
  draftId?: string;
};

function buildQuery(query: Record<string, string | undefined>): string {
  const entries = Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  if (entries.length === 0) return "";
  return `?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`;
}

export type ParsedRoute =
  | { kind: "root" }
  | { kind: "welcome" }
  | { kind: "pair-scan" }
  | { kind: "open-project"; serverId?: string }
  | { kind: "sessions"; legacyServerId?: string }
  | { kind: "schedules" }
  | { kind: "new" }
  | { kind: "host-root"; serverId: string }
  | { kind: "agent"; serverId: string; agentId: string }
  | { kind: "workspace"; serverId: string; workspaceId: string; open: WorkspaceOpenIntent | null }
  | { kind: "settings"; section?: AppSettingsSection }
  | { kind: "projects"; projectKey?: string }
  | { kind: "host-settings"; serverId: string; section?: HostSettingsSection }
  | { kind: "unknown" };

export function parseRoute(pathWithQuery: string, isDesktop = true): ParsedRoute {
  const [path, qs = ""] = pathWithQuery.split("?");
  const parts = (path ?? "").split("/").filter(Boolean).map(decodeSegment);
  const params = new URLSearchParams(qs);

  if (parts.length === 0) return { kind: "root" };
  if (parts[0] === "welcome") return { kind: "welcome" };
  if (parts[0] === "pair-scan") return { kind: "pair-scan" };
  if (parts[0] === "open-project") return { kind: "open-project" };
  if (parts[0] === "sessions") return { kind: "sessions" };
  if (parts[0] === "schedules") return { kind: "schedules" };
  if (parts[0] === "new") return { kind: "new" };

  if (parts[0] === "h") {
    const serverId = parts[1];
    if (!serverId) return { kind: "unknown" };
    if (parts.length === 2) return { kind: "host-root", serverId };
    if (parts[2] === "open-project") return { kind: "open-project", serverId };
    if (parts[2] === "sessions") return { kind: "sessions", legacyServerId: serverId };
    if (parts[2] === "agent" && parts[3]) return { kind: "agent", serverId, agentId: parts[3] };
    if (parts[2] === "workspace" && parts[3]) {
      return { kind: "workspace", serverId, workspaceId: decodeWorkspaceId(parts[3]), open: parseOpenIntent(params.get("open") ?? undefined) };
    }
    if (parts[2] === "settings") return { kind: "host-settings", serverId };
    return { kind: "unknown" };
  }

  if (parts[0] === "settings") {
    if (parts.length === 1) return { kind: "settings" };
    if (parts[1] === "projects") {
      return parts[2] ? { kind: "projects", projectKey: parts[2] } : { kind: "projects" };
    }
    if (parts[1] === "hosts" && parts[2]) {
      return { kind: "host-settings", serverId: parts[2], section: normalizeHostSettingsSection(parts[3]) };
    }
    return { kind: "settings", section: normalizeAppSettingsSection(parts[1], isDesktop) };
  }

  return { kind: "unknown" };
}

// UTF-8 base64url without Node Buffer (app package must remain browser/Hermes-safe).
function base64UrlEncodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    output += table[(triple >> 18) & 63];
    output += table[(triple >> 12) & 63];
    output += i + 1 < bytes.length ? table[(triple >> 6) & 63] : "=";
    output += i + 2 < bytes.length ? table[triple & 63] : "=";
  }
  return output.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecodeUtf8(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes: number[] = [];
  for (let i = 0; i < padded.length; i += 4) {
    const c1 = table.indexOf(padded[i] ?? "");
    const c2 = table.indexOf(padded[i + 1] ?? "");
    const c3 = padded[i + 2] === "=" ? -1 : table.indexOf(padded[i + 2] ?? "");
    const c4 = padded[i + 3] === "=" ? -1 : table.indexOf(padded[i + 3] ?? "");
    const triple = (c1 << 18) | (c2 << 12) | ((c3 < 0 ? 0 : c3) << 6) | (c4 < 0 ? 0 : c4);
    bytes.push((triple >> 16) & 255);
    if (c3 >= 0) bytes.push((triple >> 8) & 255);
    if (c4 >= 0) bytes.push(triple & 255);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
