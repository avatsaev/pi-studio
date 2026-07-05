// Compact/mobile tab switcher view model.
// clean-room-scope/features/workspace-ui.md § Mobile tab switcher

import { descriptorForTab, type PanelDescriptor } from "./panel-registry.js";
import type { PinnedTabTarget } from "./pinned-targets.js";
import { quickLaunchButtons, type QuickLaunchButton } from "./pinned-targets.js";
import type { WorkspaceTab } from "./tabs.js";

export type MobileSwitcherEntry = {
  tabId: string;
  label: string;
  icon: string;
  statusBucket?: PanelDescriptor["statusBucket"];
  active: boolean;
  closable: boolean;
};

export type MobileSwitcherModel = {
  visibleTabId?: string;
  entries: MobileSwitcherEntry[];
  newTabActions: QuickLaunchButton[];
  splitsVisible: false;
};

export function buildMobileSwitcher(input: {
  tabs: readonly WorkspaceTab[];
  activeTabId?: string;
  pinnedTargets: readonly PinnedTabTarget[];
  nextDraftId: string;
  nextTerminalId: string;
  nextBrowserId: string;
}): MobileSwitcherModel {
  const visibleTabId = input.activeTabId ?? input.tabs[0]?.tabId;
  return {
    visibleTabId,
    entries: input.tabs.map((tab) => {
      const descriptor = descriptorForTab(tab);
      return {
        tabId: tab.tabId,
        label: descriptor.label,
        icon: descriptor.icon,
        statusBucket: descriptor.statusBucket,
        active: tab.tabId === visibleTabId,
        closable: true,
      };
    }),
    newTabActions: quickLaunchButtons(input.pinnedTargets, input),
    splitsVisible: false,
  };
}

export function compactVisibleTabs(tabs: readonly WorkspaceTab[], activeTabId?: string): WorkspaceTab[] {
  const active = activeTabId ? tabs.find((tab) => tab.tabId === activeTabId) : undefined;
  const first = active ?? tabs[0];
  return first ? [first] : [];
}
