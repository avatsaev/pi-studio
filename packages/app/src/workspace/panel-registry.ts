// Workspace panel registry metadata.
// clean-room-scope/features/workspace-ui.md § Tab model

import { defaultTabLabel, type WorkspaceTab, type WorkspaceTabDescriptor, type WorkspaceTabKind, type WorkspaceTabTarget } from "./tabs.js";

export type StatusBucket = "needs_input" | "failed" | "running" | "attention" | "idle";
export type TitleState = "ready" | "loading" | "skeleton";

export type PanelDescriptor = {
  label: string;
  subtitle?: string;
  titleState: TitleState;
  icon: string;
  statusBucket?: StatusBucket;
};

export type PaneContext = {
  serverId: string;
  workspaceId: string;
  tabId: string;
  target: WorkspaceTabTarget;
  openTab: (target: WorkspaceTabTarget) => void;
  closeCurrentTab: () => void;
  retargetCurrentTab: (target: WorkspaceTabTarget) => void;
  openFileInWorkspace: (path: string, range?: { lineStart?: number; lineEnd?: number }) => void;
  openImportSheet: () => void;
};

export type PaneFocusContext = {
  isWorkspaceFocused: boolean;
  isPaneFocused: boolean;
  isInteractive: boolean;
  focusPane: () => void;
};

export type PanelRegistryEntry = {
  kind: WorkspaceTabKind;
  component: string;
  useDescriptor: (tab: WorkspaceTab, hints?: DescriptorHints) => PanelDescriptor;
  confirmClose?: (tab: WorkspaceTab) => string | null;
};

export type DescriptorHints = {
  title?: string;
  subtitle?: string;
  loading?: boolean;
  statusBucket?: StatusBucket;
  favicon?: string;
};

export type PanelRegistry = Record<WorkspaceTabKind, PanelRegistryEntry>;

export const WORKSPACE_PANEL_REGISTRY: PanelRegistry = {
  draft: entry("draft", "AgentConversationPanel", "sparkles"),
  agent: entry("agent", "AgentConversationPanel", "bot", (tab) => `Close ${defaultTabLabel(tab.target)}?`),
  terminal: entry("terminal", "TerminalPanel", "terminal", () => "Close terminal? Running processes may stop."),
  browser: entry("browser", "BrowserPanel", "globe"),
  file: entry("file", "FilePreviewPanel", "file"),
  setup: entry("setup", "SetupPanel", "wrench"),
};

export function descriptorForTab(tab: WorkspaceTab, hints: DescriptorHints = {}): PanelDescriptor {
  return WORKSPACE_PANEL_REGISTRY[tab.target.kind].useDescriptor(tab, hints);
}

export function registryEntryForDescriptor(descriptor: WorkspaceTabDescriptor): PanelRegistryEntry {
  return WORKSPACE_PANEL_REGISTRY[descriptor.kind];
}

function entry(
  kind: WorkspaceTabKind,
  component: string,
  icon: string,
  confirmClose?: (tab: WorkspaceTab) => string | null,
): PanelRegistryEntry {
  return {
    kind,
    component,
    confirmClose,
    useDescriptor: (tab, hints = {}) => ({
      label: hints.loading ? "" : (hints.title ?? defaultTabLabel(tab.target)),
      subtitle: hints.subtitle,
      titleState: hints.loading ? "skeleton" : "ready",
      icon: hints.favicon ?? icon,
      statusBucket: hints.statusBucket,
    }),
  };
}
