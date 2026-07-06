// Panel plug-in contract.
// clean-room-scope/features/feature-panels-ui.md § How panels plug in

import type { WorkspaceTab, WorkspaceTabKind, WorkspaceTabTarget } from "../workspace/tabs.js";
import type { PanelDescriptor, DescriptorHints } from "../workspace/panel-registry.js";

// ─── Pane context (extended contract) ──────────────────────────────────────

export type PanelPaneContext = {
  serverId: string;
  workspaceId: string;
  tabId: string;
  target: WorkspaceTabTarget;
  workspaceDir?: string;
  workspaceAvailable: boolean;
  openTab: (target: WorkspaceTabTarget) => void;
  closeCurrentTab: () => void;
  retargetCurrentTab: (target: WorkspaceTabTarget) => void;
  openFileInWorkspace: (path: string, range?: { lineStart?: number; lineEnd?: number }) => void;
  openImportSheet: () => void;
};

export type PanelPaneFocusContext = {
  isWorkspaceFocused: boolean;
  isPaneFocused: boolean;
  isInteractive: boolean;
  focusPane: () => void;
};

// ─── Panel descriptor re-exports (authoritative in workspace/panel-registry) ─
// These are re-used here without re-exporting to avoid duplicate exports.
export type { PanelDescriptor, StatusBucket, TitleState, DescriptorHints } from "../workspace/panel-registry.js";

// ─── Registered panel entry ────────────────────────────────────────────────

export type ConfirmCloseResult = { shouldConfirm: false } | { shouldConfirm: true; message: string };

export type PanelRegistration = {
  kind: WorkspaceTabKind;
  /** Human-readable component name (for debug + preview). */
  componentName: string;
  useDescriptor: (tab: WorkspaceTab, hints?: DescriptorHints) => PanelDescriptor;
  /** If defined and returns a non-null string, the tab asks for close confirmation. */
  confirmClose?: (tab: WorkspaceTab) => string | null;
};

// ─── Panel header contribution ──────────────────────────────────────────

export type PanelHeaderAction = {
  id: string;
  label: string;
  iconOnly: boolean;
  disabled?: boolean;
  badge?: string;
};

export type PanelHeaderContribution = {
  title: string;
  subtitle?: string;
  actions: PanelHeaderAction[];
};

// ─── Workspace availability check ──────────────────────────────────────

export function checkWorkspaceAvailable(workspaceDir: string | undefined): boolean {
  return Boolean(workspaceDir);
}

export function workspaceUnavailableMessage(): string {
  return "Workspace is unavailable";
}

// ─── Confirm-close helpers ────────────────────────────────────────────────

export function resolveConfirmClose(registration: PanelRegistration, tab: WorkspaceTab): ConfirmCloseResult {
  const message = registration.confirmClose?.(tab) ?? null;
  if (message) return { shouldConfirm: true, message };
  return { shouldConfirm: false };
}

// ─── Default descriptor factory ──────────────────────────────────────────

export function defaultDescriptor(
  kind: WorkspaceTabKind,
  icon: string,
  defaultLabel: string,
  tab: WorkspaceTab,
  hints: DescriptorHints = {},
): PanelDescriptor {
  return {
    label: hints.loading ? "" : (hints.title ?? defaultLabel),
    subtitle: hints.subtitle,
    titleState: hints.loading ? "skeleton" : "ready",
    icon: hints.favicon ?? icon,
    statusBucket: hints.statusBucket,
  };
}
