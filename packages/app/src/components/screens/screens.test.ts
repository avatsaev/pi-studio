/**
 * Tests for onboarding screen logic (task-001).
 * Pure validation/model tests — no DOM/JSX needed.
 */

import { describe, it, expect } from "vitest";
import { validateHostAddress, type AddHostValidation } from "./AddHostForm.js";
import { welcomeActions, welcomeAutoRedirect } from "../../onboarding/welcome.js";
import {
  decodePairingOffer,
  importPairingOffer,
  pairScanAvailability,
} from "../../onboarding/pairing.js";
import {
  visibleOpenProjectTiles,
  openProjectTileLayout,
} from "../../screens/open-project.js";
import {
  aggregateSessions,
  aggregateSchedules,
  scheduleBucket,
  type HostSessions,
  type HostSchedules,
  type ScheduleRecord,
} from "../../screens/cross-host.js";
import {
  parseNewWorkspaceParams,
  createAgentDefaults,
  submitNewWorkspace,
  worktreeCapableProjects,
  filterRefs,
  type ProjectPickerItem,
} from "../../screens/new-workspace.js";
import { validateProjectPath } from "./OpenProjectScreen.js";
import { launchGate } from "./NewWorkspaceScreen.js";
import {
  resolveSettingsView,
  appSettingsItems,
  hostPickerRows,
  daemonModeToggle,
} from "../../screens/settings.js";
import { resolveProjectsListState } from "../../screens/projects-settings.js";
import {
  commandCenterItems,
  STATIC_COMMAND_ACTIONS,
  activateCommandCenterItem,
} from "../../screens/command-center.js";
import type { HostRuntimeSnapshot } from "../../runtime/host-runtime.js";
import type { HostProfile } from "../../runtime/host-profile.js";

// ---------------------------------------------------------------------------
// AddHost validation
// ---------------------------------------------------------------------------
describe("validateHostAddress", () => {
  it("empty string → invalid", () => {
    const r = validateHostAddress("");
    expect(r.valid).toBe(false);
  });

  it("bare host:port → ws://host:port", () => {
    const r = validateHostAddress("localhost:6767");
    expect(r).toEqual({ valid: true, url: "ws://localhost:6767" });
  });

  it("ws:// prefix → normalized", () => {
    const r = validateHostAddress("ws://192.168.1.5:6767/");
    expect(r).toEqual({ valid: true, url: "ws://192.168.1.5:6767" });
  });

  it("wss:// prefix → accepted", () => {
    const r = validateHostAddress("wss://example.com:8443");
    expect(r).toEqual({ valid: true, url: "wss://example.com:8443" });
  });

  it("http:// → invalid protocol", () => {
    const r = validateHostAddress("http://localhost:6767");
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.error).toContain("ws://");
  });

  it("garbage → invalid format", () => {
    const r = validateHostAddress("not a url !!!");
    expect(r.valid).toBe(false);
  });

  it("host without port → valid (ws://host)", () => {
    const r = validateHostAddress("my-server.local");
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.url).toContain("ws://my-server.local");
  });
});

// ---------------------------------------------------------------------------
// WelcomeScreen model
// ---------------------------------------------------------------------------
describe("WelcomeScreen model", () => {
  it("welcome actions differ by platform", () => {
    expect(welcomeActions("web").length).toBe(2);
    expect(welcomeActions("native").length).toBe(3);
    expect(welcomeActions("desktop").length).toBe(3);
  });

  it("auto-redirect returns null with no online hosts", () => {
    const host: HostRuntimeSnapshot = {
      profile: { id: "p1", kind: "direct", label: "off", url: "ws://x", createdAtMs: 1 } as HostProfile,
      status: "offline",
      serverId: "srv-off",
      features: {},
      reconnectAttempt: 0,
    };
    expect(welcomeAutoRedirect([host])).toBeNull();
  });

  it("auto-redirect picks earliest online host", () => {
    const mkHost = (id: string, ms: number): HostRuntimeSnapshot => ({
      profile: { id: `p-${id}`, kind: "direct", label: id, url: `ws://${id}`, createdAtMs: ms, serverId: id } as any,
      status: "online",
      serverId: id,
      features: {},
      reconnectAttempt: 0,
    });
    expect(welcomeAutoRedirect([mkHost("b", 20), mkHost("a", 10)])).toBe("/h/a");
  });
});

// ---------------------------------------------------------------------------
// PairScan model
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// HomeScreen model
// ---------------------------------------------------------------------------
describe("HomeScreen model", () => {
  it("shows 4 tiles for local host (pair device visible)", () => {
    const host: HostRuntimeSnapshot = {
      profile: { id: "p1", kind: "local-embedded", label: "local", localUrl: "ws://localhost:6767", createdAtMs: 1 } as any,
      status: "online",
      serverId: "srv-1",
      features: {},
      reconnectAttempt: 0,
    };
    const tiles = visibleOpenProjectTiles({ serverId: "srv-1", host });
    expect(tiles.length).toBe(4);
    expect(tiles.find((t) => t.id === "pair-device")).toBeTruthy();
  });

  it("hides pair-device for remote host", () => {
    const host: HostRuntimeSnapshot = {
      profile: { id: "p1", kind: "relay", label: "remote", relayUrl: "wss://relay", createdAtMs: 1 } as any,
      status: "online",
      serverId: "srv-2",
      features: {},
      reconnectAttempt: 0,
    };
    const tiles = visibleOpenProjectTiles({ serverId: "srv-2", host });
    expect(tiles.find((t) => t.id === "pair-device")).toBeUndefined();
  });

  it("tile layout: narrow → stacked; wide → cards", () => {
    expect(openProjectTileLayout(400)).toBe("stacked");
    expect(openProjectTileLayout(800)).toBe("cards");
  });
});

// ---------------------------------------------------------------------------
// SessionsScreen model
// ---------------------------------------------------------------------------
describe("SessionsScreen model", () => {
  const mkHost = (id: string, rows: { agentId: string; title: string; lastActivityMs: number }[]): HostSessions => ({
    serverId: id,
    hostLabel: id,
    loading: false,
    rows,
  });

  it("loading state when all hosts loading", () => {
    const hosts: HostSessions[] = [{ serverId: "a", hostLabel: "A", loading: true, rows: [] }];
    expect(aggregateSessions(hosts).kind).toBe("loading");
  });

  it("empty state with no rows", () => {
    const hosts = [mkHost("a", [])];
    expect(aggregateSessions(hosts).kind).toBe("empty");
  });

  it("list state sorted by lastActivityMs desc", () => {
    const hosts = [mkHost("a", [
      { agentId: "ag1", title: "Old", lastActivityMs: 100 },
      { agentId: "ag2", title: "New", lastActivityMs: 500 },
    ])];
    const state = aggregateSessions(hosts);
    expect(state.kind).toBe("list");
    if (state.kind === "list") {
      expect(state.rows[0]!.title).toBe("New");
      expect(state.rows[1]!.title).toBe("Old");
    }
  });

  it("showHostFilter only when >1 host", () => {
    const one = [mkHost("a", [{ agentId: "x", title: "X", lastActivityMs: 1 }])];
    const two = [mkHost("a", [{ agentId: "x", title: "X", lastActivityMs: 1 }]), mkHost("b", [])];
    const s1 = aggregateSessions(one);
    const s2 = aggregateSessions(two);
    if (s1.kind === "list") expect(s1.showHostFilter).toBe(false);
    if (s2.kind === "list") expect(s2.showHostFilter).toBe(true);
  });

  it("filter by serverId scopes results", () => {
    const hosts = [mkHost("a", [{ agentId: "x", title: "A", lastActivityMs: 1 }]), mkHost("b", [{ agentId: "y", title: "B", lastActivityMs: 2 }])];
    const state = aggregateSessions(hosts, "b");
    if (state.kind === "list") {
      expect(state.rows.length).toBe(1);
      expect(state.rows[0]!.title).toBe("B");
    }
  });

  it("errors propagated", () => {
    const hosts: HostSessions[] = [{ serverId: "a", hostLabel: "A", loading: false, error: "fail", rows: [] }];
    const state = aggregateSessions(hosts);
    if (state.kind === "empty") expect(state.errors.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// OpenProjectScreen validation
// ---------------------------------------------------------------------------
describe("OpenProjectScreen validation", () => {
  it("empty path → invalid", () => {
    expect(validateProjectPath("").valid).toBe(false);
  });

  it("relative path → invalid", () => {
    const r = validateProjectPath("relative/path");
    expect(r.valid).toBe(false);
  });

  it("absolute path → valid", () => {
    expect(validateProjectPath("/home/user/project")).toEqual({ valid: true, path: "/home/user/project" });
  });

  it("tilde path → valid", () => {
    expect(validateProjectPath("~/project")).toEqual({ valid: true, path: "~/project" });
  });
});

// ---------------------------------------------------------------------------
// NewWorkspaceScreen model
// ---------------------------------------------------------------------------
describe("NewWorkspaceScreen model", () => {
  it("parseNewWorkspaceParams extracts all fields", () => {
    const params = parseNewWorkspaceParams("serverId=srv&dir=/tmp&name=test&projectId=p1&draftId=d1");
    expect(params).toEqual({ serverId: "srv", dir: "/tmp", name: "test", projectId: "p1", draftId: "d1" });
  });

  it("createAgentDefaults falls back gracefully", () => {
    const d = createAgentDefaults(undefined);
    expect(d.isolation).toBe("worktree");
    expect(d.favoriteModels).toEqual([]);
  });

  it("createAgentDefaults uses provider preferences", () => {
    const d = createAgentDefaults({
      provider: "pi",
      providerPreferences: { pi: { model: "gpt-4", mode: "rpc" } },
      isolation: "local",
    });
    expect(d.provider).toBe("pi");
    expect(d.model).toBe("gpt-4");
    expect(d.isolation).toBe("local");
  });

  it("worktreeCapableProjects filters correctly", () => {
    const projects: ProjectPickerItem[] = [
      { projectId: "a", projectKey: "a", name: "A", worktreeCapable: true },
      { projectId: "b", projectKey: "b", name: "B", worktreeCapable: false },
    ];
    expect(worktreeCapableProjects(projects).length).toBe(1);
  });

  it("filterRefs filters by label substring", () => {
    const refs = [{ id: "1", label: "main", kind: "branch" as const }, { id: "2", label: "feature/foo", kind: "branch" as const }];
    expect(filterRefs(refs, "feat").length).toBe(1);
    expect(filterRefs(refs, "").length).toBe(2);
  });

  it("launchGate blocks without serverId", () => {
    expect(launchGate({ provider: "pi" })).toEqual({ blocked: true, reason: "No host selected" });
  });

  it("launchGate blocks without provider", () => {
    expect(launchGate({ serverId: "srv" })).toEqual({ blocked: true, reason: "Select a provider" });
  });

  it("launchGate passes when both present", () => {
    expect(launchGate({ serverId: "srv", provider: "pi" })).toEqual({ blocked: false });
  });

  it("submitNewWorkspace with empty text creates empty worktree", async () => {
    const result = await submitNewWorkspace({
      params: { serverId: "srv" },
      client: {
        async createEmptyWorktree() { return { workspaceId: "ws-1" }; },
        async ensureWorktree() { return { workspaceId: "ws-1" }; },
        async stagePendingDraft() { return { draftId: "d-1" }; },
      },
      text: "",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workspaceId).toBe("ws-1");
      expect(result.draftId).toBeUndefined();
    }
  });

  it("submitNewWorkspace with text stages a draft", async () => {
    const result = await submitNewWorkspace({
      params: { serverId: "srv" },
      client: {
        async createEmptyWorktree() { return { workspaceId: "ws-1" }; },
        async ensureWorktree() { return { workspaceId: "ws-1" }; },
        async stagePendingDraft() { return { draftId: "d-1" }; },
      },
      text: "Fix the bug",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draftId).toBe("d-1");
    }
  });

  it("submitNewWorkspace fails without serverId", async () => {
    const result = await submitNewWorkspace({
      params: {},
      client: {
        async createEmptyWorktree() { return { workspaceId: "ws-1" }; },
        async ensureWorktree() { return { workspaceId: "ws-1" }; },
        async stagePendingDraft() { return { draftId: "d-1" }; },
      },
      text: "hello",
    });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SettingsScreen model
// ---------------------------------------------------------------------------
describe("SettingsScreen model", () => {

  it("resolveSettingsView: /settings on wide → general section", () => {
    const view = resolveSettingsView("/settings", false, true);
    expect(view).toEqual({ kind: "section", section: "general" });
  });

  it("resolveSettingsView: /settings on compact → root", () => {
    const view = resolveSettingsView("/settings", false, false);
    expect(view).toEqual({ kind: "root" });
  });

  it("resolveSettingsView: /settings/appearance → appearance section", () => {
    const view = resolveSettingsView("/settings/appearance", false, true);
    expect(view).toEqual({ kind: "section", section: "appearance" });
  });

  it("resolveSettingsView: /settings/projects → projects", () => {
    const view = resolveSettingsView("/settings/projects", false, true);
    expect(view).toEqual({ kind: "projects" });
  });

  it("resolveSettingsView: /settings/projects/my-key → project", () => {
    const view = resolveSettingsView("/settings/projects/my-key", false, true);
    expect(view).toEqual({ kind: "project", projectKey: "my-key" });
  });

  it("resolveSettingsView: /settings/hosts/srv-1/agents → host", () => {
    const view = resolveSettingsView("/settings/hosts/srv-1/agents", false, true);
    expect(view).toEqual({ kind: "host", serverId: "srv-1", section: "agents" });
  });

  it("appSettingsItems: non-desktop filters desktop-only", () => {
    const items = appSettingsItems(false);
    const ids = items.map((i) => i.id);
    expect(ids).not.toContain("daemon");
    expect(ids).not.toContain("shortcuts");
    expect(ids).toContain("general");
    expect(ids).toContain("appearance");
  });

  it("appSettingsItems: desktop includes all", () => {
    const items = appSettingsItems(true);
    const ids = items.map((i) => i.id);
    expect(ids).toContain("daemon");
    expect(ids).toContain("shortcuts");
  });

  it("hostPickerRows: sorts local first + adds add-host", () => {
    const hosts: any[] = [
      { profile: { kind: "relay", label: "Remote", createdAtMs: 1, serverId: "r" }, serverId: "r", status: "online" },
      { profile: { kind: "local-embedded", label: "Local", createdAtMs: 2, serverId: "l" }, serverId: "l", status: "online" },
    ];
    const rows = hostPickerRows(hosts);
    expect(rows[0]).toMatchObject({ kind: "host", label: "Local" });
    expect(rows[rows.length - 1]).toMatchObject({ kind: "add-host" });
  });

  it("daemonModeToggle: embedded → remote-only with warning when only host", () => {
    const result = daemonModeToggle({ currentMode: "embedded", embeddedIsOnlyHost: true });
    expect(result.nextMode).toBe("remote-only");
    expect(result.requiresConfirmation).toBe(true);
  });

  it("daemonModeToggle: remote-only → embedded no confirmation", () => {
    const result = daemonModeToggle({ currentMode: "remote-only", embeddedIsOnlyHost: false });
    expect(result.nextMode).toBe("embedded");
    expect(result.requiresConfirmation).toBe(false);
  });

  it("resolveProjectsListState: loading", () => {
    expect(resolveProjectsListState({ loading: true, projects: [] })).toEqual({ kind: "loading" });
  });

  it("resolveProjectsListState: empty (excludes archived)", () => {
    const state = resolveProjectsListState({ loading: false, projects: [{ projectKey: "a", name: "A", hostServerId: "h", archived: true }] });
    expect(state.kind).toBe("empty");
  });

  it("resolveProjectsListState: list sorted by name", () => {
    const state = resolveProjectsListState({ loading: false, projects: [
      { projectKey: "b", name: "Beta", hostServerId: "h" },
      { projectKey: "a", name: "Alpha", hostServerId: "h" },
    ] });
    expect(state.kind).toBe("list");
    if (state.kind === "list") expect(state.projects[0]!.name).toBe("Alpha");
  });
});

// ---------------------------------------------------------------------------
// SchedulesScreen model
// ---------------------------------------------------------------------------
describe("SchedulesScreen model", () => {
  const baseSchedule: ScheduleRecord = {
    id: "sched-1",
    name: "Daily check",
    prompt: "Check status",
    cadence: { type: "every", everyMs: 86400000 },
    target: { type: "new-agent", config: { provider: "pi" } },
    status: "active",
    createdAt: "2025-01-01T00:00:00Z",
    runs: [],
  };

  const mkHost = (id: string, schedules: ScheduleRecord[]): HostSchedules => ({
    serverId: id,
    hostLabel: id,
    loading: false,
    agentDirectoryReady: true,
    agents: [],
    schedules,
  });

  it("scheduleBucket: active schedule → active", () => {
    expect(scheduleBucket(baseSchedule, Date.now())).toBe("active");
  });

  it("scheduleBucket: completed → ended", () => {
    expect(scheduleBucket({ ...baseSchedule, status: "completed" }, Date.now())).toBe("ended");
  });

  it("scheduleBucket: maxRuns reached → ended", () => {
    expect(scheduleBucket({ ...baseSchedule, maxRuns: 1, runs: [{ id: "r1", status: "succeeded" }] }, Date.now())).toBe("ended");
  });

  it("aggregateSchedules: loading when all loading", () => {
    const hosts: HostSchedules[] = [{ serverId: "a", hostLabel: "A", loading: true, agentDirectoryReady: false, agents: [], schedules: [] }];
    expect(aggregateSchedules(hosts, { statusFilter: "active", nowMs: Date.now() }).kind).toBe("loading");
  });

  it("aggregateSchedules: empty with no active schedules", () => {
    const hosts = [mkHost("a", [{ ...baseSchedule, status: "completed" }])];
    expect(aggregateSchedules(hosts, { statusFilter: "active", nowMs: Date.now() }).kind).toBe("empty");
  });

  it("aggregateSchedules: list with matching filter", () => {
    const hosts = [mkHost("a", [baseSchedule])];
    const state = aggregateSchedules(hosts, { statusFilter: "active", nowMs: Date.now() });
    expect(state.kind).toBe("list");
    if (state.kind === "list") expect(state.rows.length).toBe(1);
  });

  it("aggregateSchedules: host filter scopes", () => {
    const hosts = [mkHost("a", [baseSchedule]), mkHost("b", [{ ...baseSchedule, id: "sched-2" }])];
    const state = aggregateSchedules(hosts, { hostFilter: "a", statusFilter: "active", nowMs: Date.now() });
    if (state.kind === "list") expect(state.rows.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Command center wiring
// ---------------------------------------------------------------------------
describe("Command center wiring", () => {
  it("static actions include sessions and schedules", () => {
    const ids = STATIC_COMMAND_ACTIONS.map((a) => a.id);
    expect(ids).toContain("sessions");
    expect(ids).toContain("schedules");
    expect(ids).toContain("home");
    expect(ids).toContain("settings");
  });

  it("commandCenterItems returns actions matching query", () => {
    const items = commandCenterItems({ agents: [], query: "sched" });
    expect(items.some((i) => i.label === "Schedules")).toBe(true);
  });

  it("activateCommandCenterItem returns route", () => {
    const items = commandCenterItems({ agents: [], query: "" });
    const result = activateCommandCenterItem(items[0]!);
    expect(result.route).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PairScan model (screens layer)
// ---------------------------------------------------------------------------
describe("PairScan model (screens layer)", () => {
  it("web platform → unsupported", () => {
    expect(pairScanAvailability("web")).toBe("unsupported");
  });

  it("native platform → camera", () => {
    expect(pairScanAvailability("native")).toBe("camera");
  });

  it("import pairing offer validates + upserts + returns route", async () => {
    const offer = {
      v: 1,
      kind: "relay-offer",
      label: "My Laptop",
      relayUrl: "wss://relay.example",
      sessionId: "sess-1",
      daemonPublicKeyB64: "pk",
      serverId: "srv-1",
    };
    const payload = `#offer=${encodeURIComponent(JSON.stringify(offer))}`;

    const result = await importPairingOffer({
      urlOrFragment: payload,
      source: "onboarding",
      probe: async () => ({ serverId: "srv-1", label: "My Laptop" }),
      upsert: () => {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.route).toBe("/h/srv-1");
      expect(result.profile.kind).toBe("relay");
    }
  });

  it("decode pairing offer with invalid JSON → error", () => {
    const result = decodePairingOffer("#offer=notjson");
    expect(result.ok).toBe(false);
  });
});
