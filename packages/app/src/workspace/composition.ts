// Workspace screen composition and header/action view models.
// clean-room-scope/features/workspace-ui.md § Top-level layout, § Primary header

import type { SplitPane } from "./layout.js";
import type { WorkspaceTab } from "./tabs.js";

export type WorkspaceFormFactor = "mobile" | "narrow" | "wide";

export type WorkspaceComposition = {
  showPrimaryHeader: boolean;
  showExplorerSidebar: boolean;
  tabStripMode: "mobile-switcher" | "single" | "per-pane";
  rootModals: readonly ["import-session", "rename-tab"];
};

export function composeWorkspaceScreen(input: {
  focusMode: boolean;
  formFactor: WorkspaceFormFactor;
  platform: "web" | "desktop" | "ios" | "android";
  explorerOpen: boolean;
  workspaceDirPresent: boolean;
  panes: readonly SplitPane[];
}): WorkspaceComposition {
  return {
    showPrimaryHeader: !input.focusMode || input.formFactor === "mobile",
    showExplorerSidebar: input.formFactor === "wide" && input.explorerOpen && input.workspaceDirPresent,
    tabStripMode: input.formFactor === "mobile" ? "mobile-switcher" : input.platform === "web" && input.panes.length > 1 ? "per-pane" : "single",
    rootModals: ["import-session", "rename-tab"],
  };
}

export type HeaderInput = {
  loading: boolean;
  title?: string;
  projectSubtitle?: string;
  branch?: string;
  detachedHead?: boolean;
  projectKind: "git" | "non_git";
  formFactor: WorkspaceFormFactor;
  scriptsCount: number;
  workspaceDir?: string;
  diffStat?: { added: number; modified: number; deleted: number };
  setupAvailable: boolean;
  terminalReady: boolean;
  isElectron: boolean;
};

export type HeaderModel = {
  left: { sidebarToggle: boolean; title: string; loading: boolean; branch?: string; subtitle?: string };
  menuItems: HeaderMenuItem[];
  right: HeaderAction[];
};

export type HeaderMenuItem = { id: string; label: string; disabled?: boolean };
export type HeaderAction = { id: string; label: string; iconOnly: boolean; disabled?: boolean; badge?: string };

export function workspaceHeaderModel(input: HeaderInput): HeaderModel {
  const mobile = input.formFactor === "mobile";
  const iconOnly = input.formFactor === "narrow";
  const title = input.loading ? "" : (input.title ?? "Workspace");
  const subtitle = input.projectSubtitle && input.projectSubtitle.toLowerCase() !== title.toLowerCase() ? input.projectSubtitle : undefined;
  const branch = input.projectKind === "git" && !input.detachedHead ? input.branch : undefined;
  const menuItems: HeaderMenuItem[] = [
    { id: "new-agent", label: "New agent" },
    { id: "new-terminal", label: "New terminal", disabled: !input.terminalReady },
    ...(input.isElectron ? [{ id: "new-browser", label: "New browser tab" }] : []),
    { id: "import-session", label: "Import session" },
    ...(input.workspaceDir ? [{ id: "copy-path", label: "Copy workspace path" }] : []),
    ...(branch ? [{ id: "copy-branch", label: "Copy branch name" }] : []),
    ...(input.setupAvailable ? [{ id: "show-setup", label: "Show setup" }] : []),
    ...(mobile && input.scriptsCount > 0 ? [{ id: "scripts", label: "Scripts" }] : []),
  ];

  const right: HeaderAction[] = mobile
    ? [{ id: "explorer", label: "Explorer", iconOnly: true, badge: diffBadge(input.diffStat) }]
    : [
        ...(input.scriptsCount > 0 ? [{ id: "scripts", label: "Scripts", iconOnly }] : []),
        ...(input.workspaceDir ? [{ id: "open-editor", label: "Open in editor", iconOnly }] : []),
        { id: input.projectKind === "git" ? "git-explorer" : "explorer", label: "Explorer", iconOnly, badge: diffBadge(input.diffStat) },
      ];

  return { left: { sidebarToggle: true, title, loading: input.loading, branch, subtitle }, menuItems, right };
}

function diffBadge(stat: HeaderInput["diffStat"]): string | undefined {
  if (!stat) return undefined;
  const total = stat.added + stat.modified + stat.deleted;
  return total > 0 ? String(total) : undefined;
}

export type ScriptRecord = { id: string; name: string; terminalId?: string; serviceUrl?: string };
export type ScriptAction = { scriptId: string; label: string; primary: "start" | "view"; serviceUrl?: string };

export function scriptButtonModel(scripts: readonly ScriptRecord[], isMobile: boolean): { visible: boolean; variant: "split" | "ghost"; actions: ScriptAction[] } {
  return {
    visible: scripts.length > 0,
    variant: isMobile ? "ghost" : "split",
    actions: scripts.map((script) => ({ scriptId: script.id, label: script.name, primary: script.terminalId ? "view" : "start", serviceUrl: script.serviceUrl })),
  };
}

export type OpenEditorTarget = { id: string; label: string; kind: "editor" | "github" | "file"; preferred?: boolean; path?: string; url?: string };

export function openInEditorTargets(input: {
  platform: "web" | "desktop" | "ios" | "android";
  cwd?: string;
  preferredEditor?: string;
  desktopEditors: readonly { id: string; label: string }[];
  githubUrl?: string;
  activeFilePath?: string;
}): OpenEditorTarget[] {
  if (input.platform !== "web" || !input.cwd?.startsWith("/")) return [];
  const editorTargets = input.desktopEditors.map((editor) => ({
    id: editor.id,
    label: editor.label,
    kind: "editor" as const,
    preferred: editor.id === input.preferredEditor,
    path: input.cwd,
  }));
  return [
    ...editorTargets,
    ...(input.githubUrl ? [{ id: "github", label: "Open on GitHub", kind: "github" as const, url: input.githubUrl }] : []),
    ...(input.activeFilePath ? [{ id: "active-file", label: "Open active file", kind: "file" as const, path: input.activeFilePath }] : []),
  ];
}

export function workspaceActionCluster(input: HeaderInput): HeaderAction[] {
  return workspaceHeaderModel(input).right;
}

export function isMiddleClickClose(event: { platform: "web" | "desktop" | "ios" | "android"; button: number }): boolean {
  return event.platform === "web" && event.button === 1;
}

export type WorkspaceRootModal = "import-session" | "rename-tab";
export type WorkspaceScreenShell = { centerColumn: true; paneContent: true; rootModals: WorkspaceRootModal[]; tabCount: number };

export function workspaceScreenShell(tabs: readonly WorkspaceTab[]): WorkspaceScreenShell {
  return { centerColumn: true, paneContent: true, rootModals: ["import-session", "rename-tab"], tabCount: tabs.length };
}
