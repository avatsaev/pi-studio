import { describe, expect, it } from "vitest";

import {
  bulkCloseConfirmation,
  classifyBulkClose,
  composeWorkspaceScreen,
  createWorkspaceTab,
  distributeTabWidths,
  isMiddleClickClose,
  openInEditorTargets,
  planBulkClose,
  scriptButtonModel,
  tabContextMenu,
  tabTooltip,
  trailingTabActions,
  workspaceActionCluster,
  workspaceHeaderModel,
  workspaceScreenShell,
} from "./index.js";

const baseHeader = {
  loading: false,
  title: "Repo",
  projectSubtitle: "Project",
  branch: "main",
  detachedHead: false,
  projectKind: "git" as const,
  formFactor: "wide" as const,
  scriptsCount: 1,
  workspaceDir: "/repo",
  diffStat: { added: 1, modified: 2, deleted: 0 },
  setupAvailable: true,
  terminalReady: true,
  isElectron: true,
};

describe("workspace composition and header", () => {
  it("composes header visibility, explorer sidebar, tab strip mode, and root modals", () => {
    expect(composeWorkspaceScreen({ focusMode: true, formFactor: "wide", platform: "web", explorerOpen: true, workspaceDirPresent: true, panes: [{ kind: "pane", id: "a", tabIds: [] }] })).toMatchObject({
      showPrimaryHeader: false,
      showExplorerSidebar: true,
      tabStripMode: "single",
      rootModals: ["import-session", "rename-tab"],
    });
    expect(composeWorkspaceScreen({ focusMode: true, formFactor: "mobile", platform: "ios", explorerOpen: true, workspaceDirPresent: true, panes: [] }).showPrimaryHeader).toBe(true);
    expect(composeWorkspaceScreen({ focusMode: false, formFactor: "wide", platform: "web", explorerOpen: false, workspaceDirPresent: true, panes: [{ kind: "pane", id: "a", tabIds: [] }, { kind: "pane", id: "b", tabIds: [] }] }).tabStripMode).toBe("per-pane");
  });

  it("header shows branch, workspace menu, and git/non-git right cluster by form factor", () => {
    const model = workspaceHeaderModel(baseHeader);
    expect(model.left).toMatchObject({ title: "Repo", branch: "main", subtitle: "Project" });
    expect(model.menuItems.map((item) => item.id)).toEqual(["new-agent", "new-terminal", "new-browser", "import-session", "copy-path", "copy-branch", "show-setup"]);
    expect(model.right.map((item) => item.id)).toEqual(["scripts", "open-editor", "git-explorer"]);
    expect(model.right.at(-1)?.badge).toBe("3");

    const mobile = workspaceHeaderModel({ ...baseHeader, formFactor: "mobile" });
    expect(mobile.right).toEqual([{ id: "explorer", label: "Explorer", iconOnly: true, badge: "3" }]);
    expect(mobile.menuItems.map((item) => item.id)).toContain("scripts");

    expect(workspaceActionCluster({ ...baseHeader, projectKind: "non_git", diffStat: undefined }).at(-1)?.id).toBe("explorer");
  });

  it("script button exposes Start vs View and mobile ghost variant", () => {
    expect(scriptButtonModel([], false).visible).toBe(false);
    const model = scriptButtonModel([{ id: "dev", name: "Dev" }, { id: "api", name: "API", terminalId: "t", serviceUrl: "http://localhost" }], true);
    expect(model.variant).toBe("ghost");
    expect(model.actions.map((a) => a.primary)).toEqual(["start", "view"]);
    expect(model.actions[1]?.serviceUrl).toBe("http://localhost");
  });

  it("open-in-editor targets require web + absolute cwd and include preferred/github/active file", () => {
    expect(openInEditorTargets({ platform: "desktop", cwd: "/repo", desktopEditors: [] })).toEqual([]);
    expect(openInEditorTargets({ platform: "web", cwd: "relative", desktopEditors: [] })).toEqual([]);
    const targets = openInEditorTargets({
      platform: "web",
      cwd: "/repo",
      preferredEditor: "code",
      desktopEditors: [{ id: "code", label: "VS Code" }, { id: "zed", label: "Zed" }],
      githubUrl: "https://github.test/repo",
      activeFilePath: "/repo/a.ts",
    });
    expect(targets.map((t) => t.id)).toEqual(["code", "zed", "github", "active-file"]);
    expect(targets[0]?.preferred).toBe(true);
  });

  it("screen shell exposes center column, pane area, and root modals", () => {
    expect(workspaceScreenShell([createWorkspaceTab({ kind: "agent", agentId: "a" })])).toEqual({
      centerColumn: true,
      paneContent: true,
      rootModals: ["import-session", "rename-tab"],
      tabCount: 1,
    });
  });
});

describe("desktop tab strip", () => {
  it("distributes tab widths between icon-min and 200 and scrolls below icon minimum", () => {
    expect(distributeTabWidths(2, 600)).toEqual({ widths: [200, 200], scroll: false });
    expect(distributeTabWidths(3, 300)).toEqual({ widths: [100, 100, 100], scroll: false });
    expect(distributeTabWidths(3, 100)).toEqual({ widths: [44, 44, 44], scroll: true });
  });

  it("builds desktop/mobile tab menus with disabled close-at-ends and agent actions", () => {
    const tabs = [createWorkspaceTab({ kind: "agent", agentId: "a" }), createWorkspaceTab({ kind: "terminal", terminalId: "t" })];
    const desktop = tabContextMenu({ tab: tabs[0]!, tabs, index: 0, formFactor: "desktop" });
    expect(desktop.map((item) => item.id)).toContain("copy-agent-id");
    expect(desktop.find((item) => item.id === "close-left")?.disabled).toBe(true);
    expect(desktop.find((item) => item.id === "close-right")?.disabled).toBe(false);
    const mobile = tabContextMenu({ tab: tabs[1]!, tabs, index: 1, formFactor: "mobile" });
    expect(mobile.find((item) => item.id === "rename")).toBeDefined();
    expect(mobile.find((item) => item.id === "close-below")?.disabled).toBe(true);
  });

  it("trailing actions expose new/split/browser and middle-click close is web-only", () => {
    expect(trailingTabActions({ terminalCreating: true, electron: true, splitsSupported: true }).map((a) => a.id)).toEqual(["new-agent", "new-terminal", "new-browser", "split-right", "split-down"]);
    expect(trailingTabActions({ terminalCreating: true, electron: true, splitsSupported: true })[1]?.disabled).toBe(true);
    expect(isMiddleClickClose({ platform: "web", button: 1 })).toBe(true);
    expect(isMiddleClickClose({ platform: "desktop", button: 1 })).toBe(false);
    expect(tabTooltip(createWorkspaceTab({ kind: "agent", agentId: "a" }), "Agent")).toBe("Agent • agent_a");
  });
});

describe("bulk close", () => {
  it("classifies archive/terminal/local/subagent closures and builds confirmation", () => {
    const tabs = [
      createWorkspaceTab({ kind: "agent", agentId: "root" }),
      createWorkspaceTab({ kind: "agent", agentId: "child" }),
      createWorkspaceTab({ kind: "terminal", terminalId: "t" }),
      createWorkspaceTab({ kind: "file", path: "/repo/a.ts" }),
    ];
    const classification = classifyBulkClose(tabs, [{ agentId: "root" }, { agentId: "child", parentAgentId: "root" }]);
    expect(classification).toEqual({
      archiveAgentIds: ["root"],
      layoutOnlyAgentIds: ["child"],
      closeTerminalIds: ["t"],
      localOnlyTabIds: ["file_/repo/a.ts"],
    });
    expect(bulkCloseConfirmation(classification)).toBe("This will archive 1 agent, close 1 terminal and stop running processes, close 1 subagent tab locally, and close 1 local tab.");
    expect(planBulkClose(tabs, [{ agentId: "root" }, { agentId: "child", parentAgentId: "root" }]).closingTabIds).toEqual(["agent_root", "agent_child", "terminal_t", "file_/repo/a.ts"]);
  });
});
