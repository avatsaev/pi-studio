import { describe, expect, it } from "vitest";

import type { HostRuntimeSnapshot } from "../runtime/host-runtime.js";
import type { HostProfile } from "../runtime/host-profile.js";
import {
  appDiagnosticReport,
  appSettingsItems,
  daemonModeToggle,
  hostPickerRows,
  hostSettingsItems,
  permissionAction,
  resolveSettingsLayout,
  shortcutHelpRows,
} from "./settings.js";
import {
  editMetadataPrompt,
  editWorktreeLifecycle,
  resolveEditableProjectCopy,
  resolveProjectsListState,
} from "./projects-settings.js";
import {
  groupWorkspaces,
  shouldStartEdgeSwipe,
  sidebarMode,
  SIDEBAR_FOOTER_ACTIONS,
  translateRouteToHost,
} from "./sidebar.js";

function host(serverId: string, createdAtMs: number, kind: HostProfile["kind"] = "direct", features: Record<string, boolean> = {}): HostRuntimeSnapshot {
  const profile = kind === "local-embedded"
    ? { id: serverId, kind, label: serverId, localUrl: "ws://localhost:6767", serverId, createdAtMs }
    : { id: serverId, kind: "direct" as const, label: serverId, url: `ws://${serverId}`, serverId, createdAtMs };
  return { profile, status: "online", serverId, features, reconnectAttempt: 0 };
}

describe("settings layout and IA", () => {
  it("wide settings root redirects/resolves to general with replace nav and 320 sidebar", () => {
    expect(resolveSettingsLayout({ path: "/settings", width: 1200, isDesktop: true })).toEqual({
      mode: "wide",
      sidebarWidth: 320,
      navVerb: "replace",
      view: { kind: "section", section: "general" },
    });
  });

  it("compact settings root is root with push nav", () => {
    expect(resolveSettingsLayout({ path: "/settings", width: 390, isDesktop: true })).toMatchObject({
      mode: "compact",
      navVerb: "push",
      view: { kind: "root" },
    });
  });

  it("desktop-only sections hidden off-desktop", () => {
    expect(appSettingsItems(false).map((i) => i.id)).not.toContain("shortcuts");
    expect(appSettingsItems(false).map((i) => i.id)).not.toContain("permissions");
    expect(appSettingsItems(true).map((i) => i.id)).toContain("shortcuts");
  });

  it("host picker orders local host first and always appends Add host", () => {
    const rows = hostPickerRows([host("remote", 1), host("local", 2, "local-embedded")]);
    expect(rows[0]).toMatchObject({ kind: "host", serverId: "local", local: true });
    expect(rows.at(-1)).toEqual({ kind: "add-host", label: "Add host" });
  });

  it("provider usage support annotates Providers item", () => {
    const rows = hostSettingsItems("srv", host("srv", 1, "direct", { providerUsageList: true }));
    expect(rows.find((r) => r.id === "providers")?.label).toBe("Providers + Usage");
  });

  it("daemon mode toggle warns before disabling only embedded host", () => {
    expect(daemonModeToggle({ currentMode: "embedded", embeddedIsOnlyHost: true })).toMatchObject({
      nextMode: "remote-only",
      requiresConfirmation: true,
    });
    expect(daemonModeToggle({ currentMode: "remote-only", embeddedIsOnlyHost: false })).toMatchObject({
      nextMode: "embedded",
      requiresConfirmation: false,
    });
  });

  it("permission states map to actions", () => {
    expect(permissionAction("granted")).toBe("none");
    expect(permissionAction("prompt")).toBe("request");
    expect(permissionAction("denied")).toBe("open-settings");
  });

  it("shortcut rows format combos per OS", () => {
    const rows = shortcutHelpRows("macos");
    expect(rows.find((r) => r.id === "toggle-command-center")?.combo).toBe("⌘K");
  });

  it("diagnostic report includes version/route/hosts", () => {
    const report = appDiagnosticReport({ appVersion: "1.0.0", route: "/settings", hosts: [host("srv", 1)] });
    expect(report).toContain("version=1.0.0");
    expect(report).toContain("route=/settings");
    expect(report).toContain("srv:online:srv");
  });
});

describe("projects screens", () => {
  it("projects list states: loading/empty/list with errors", () => {
    expect(resolveProjectsListState({ loading: true, projects: [] })).toEqual({ kind: "loading" });
    expect(resolveProjectsListState({ loading: false, projects: [], hostErrors: [{ serverId: "h", message: "bad" }] })).toEqual({
      kind: "empty",
      errors: [{ serverId: "h", message: "bad" }],
    });
    const state = resolveProjectsListState({ loading: false, projects: [{ projectKey: "k", name: "Z", hostServerId: "h" }] });
    expect(state.kind).toBe("list");
  });

  it("editable project copy resolves to first online host copy", () => {
    const copy = { projectKey: "k", hostServerId: "srv", revision: 3, config: {} };
    expect(resolveEditableProjectCopy([copy], [host("srv", 1)])).toBe(copy);
    expect(resolveEditableProjectCopy([copy], [])).toBe(null);
  });

  it("metadata prompt edit keeps revision", () => {
    const patch = editMetadataPrompt({ projectKey: "k", hostServerId: "srv", revision: 2, config: {} }, "branchName", "feature/{{title}}");
    expect(patch.revision).toBe(2);
    expect(patch.config.metadataPrompts?.branchName).toBe("feature/{{title}}");
  });

  it("worktree lifecycle edit updates setup/teardown", () => {
    const patch = editWorktreeLifecycle({ projectKey: "k", hostServerId: "srv", revision: 2, config: {} }, "setup", "npm install");
    expect(patch.config.worktree?.setup).toBe("npm install");
  });
});

describe("left sidebar shell", () => {
  it("sidebar hides on unknown/welcome, pins on wide, overlays on compact, hides in focus mode", () => {
    const h = host("srv", 1);
    expect(sidebarMode({ path: "/welcome", storeReady: true, hosts: [h], isCompact: false, focusMode: false })).toBe("hidden");
    expect(sidebarMode({ path: "/h/srv/workspace/w", storeReady: true, hosts: [h], isCompact: false, focusMode: false })).toBe("pinned");
    expect(sidebarMode({ path: "/h/srv/workspace/w", storeReady: true, hosts: [h], isCompact: true, focusMode: false })).toBe("overlay");
    expect(sidebarMode({ path: "/h/srv/workspace/w", storeReady: true, hosts: [h], isCompact: false, focusMode: true })).toBe("hidden");
  });

  it("edge swipe only starts from leftmost 32px and horizontal drag", () => {
    expect(shouldStartEdgeSwipe({ x: 20, dx: 20, dy: 4, isCompact: true })).toBe(true);
    expect(shouldStartEdgeSwipe({ x: 40, dx: 20, dy: 4, isCompact: true })).toBe(false);
    expect(shouldStartEdgeSwipe({ x: 20, dx: 4, dy: 20, isCompact: true })).toBe(false);
  });

  it("groupWorkspaces groups by project and sorts recent", () => {
    const rows = [
      { workspaceId: "w1", label: "One", projectKey: "p", lastActivityMs: 1 },
      { workspaceId: "w2", label: "Two", projectKey: "p", lastActivityMs: 3 },
    ];
    expect(groupWorkspaces(rows, "project")[0]?.rows).toHaveLength(2);
    expect(groupWorkspaces(rows, "recent")[0]?.rows[0]?.workspaceId).toBe("w2");
  });

  it("footer actions include add/home/settings/host switcher/new workspace", () => {
    expect(SIDEBAR_FOOTER_ACTIONS).toEqual(["add-project", "home", "settings", "host-switcher", "new-workspace"]);
  });

  it("host switching preserves equivalent route", () => {
    expect(translateRouteToHost("/h/old/workspace/w1", "new")).toBe("/h/new/workspace/w1");
  });
});
