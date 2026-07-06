/**
 * TabStrip — workspace tab bar with width distribution, context menu,
 * trailing actions, and pinned quick-launch targets.
 * workspace-ui.md § Desktop tab strip, § Pinned targets
 */

import { useMemo, useCallback, useState, useRef } from "react";
import { X, Plus, Terminal, Globe, FileText } from "lucide-react";
import { clsx } from "clsx";
import styles from "./TabStrip.module.css";
import { Tooltip } from "../overlays/Tooltip.js";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../overlays/DropdownMenu.js";
import {
  distributeTabWidths,
  tabContextMenu,
  trailingTabActions,
  tabTooltip,
  type TabMenuItem,
  type TrailingTabAction,
} from "../../workspace/tab-strip.js";
import {
  quickLaunchButtons,
  type PinnedTabTarget,
  type QuickLaunchButton,
} from "../../workspace/pinned-targets.js";
import type { WorkspaceTab } from "../../workspace/tabs.js";
import { isMiddleClickClose } from "../../workspace/composition.js";

// ---------------------------------------------------------------------------
// Tab icon resolution
// ---------------------------------------------------------------------------

function TabIcon({ kind }: { kind: string }) {
  switch (kind) {
    case "terminal": return <Terminal size={12} />;
    case "browser": return <Globe size={12} />;
    default: return <FileText size={12} />;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type TabStripTab = WorkspaceTab & { label?: string };

export interface TabStripProps {
  tabs: readonly TabStripTab[];
  activeTabId: string | null;
  availableWidth?: number;
  isElectron?: boolean;
  splitsSupported?: boolean;
  terminalCreating?: boolean;
  pinnedTargets: readonly PinnedTabTarget[];
  nextDraftId: string;
  nextTerminalId: string;
  nextBrowserId: string;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabContextAction: (tabId: string, actionId: string) => void;
  onTrailingAction: (actionId: string) => void;
  onPinnedLaunch: (button: QuickLaunchButton) => void;
}

export function TabStrip({
  tabs,
  activeTabId,
  availableWidth = 800,
  isElectron = false,
  splitsSupported = true,
  terminalCreating = false,
  pinnedTargets,
  nextDraftId,
  nextTerminalId,
  nextBrowserId,
  onTabSelect,
  onTabClose,
  onTabContextAction,
  onTrailingAction,
  onPinnedLaunch,
}: TabStripProps) {
  const layout = useMemo(() => distributeTabWidths(tabs.length, availableWidth), [tabs.length, availableWidth]);
  const trailing = useMemo(() => trailingTabActions({ terminalCreating, electron: isElectron, splitsSupported }), [terminalCreating, isElectron, splitsSupported]);
  const pins = useMemo(
    () => quickLaunchButtons(pinnedTargets, { nextDraftId, nextTerminalId, nextBrowserId }),
    [pinnedTargets, nextDraftId, nextTerminalId, nextBrowserId],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, tabId: string) => {
      if (isMiddleClickClose({ platform: "web", button: e.button })) {
        e.preventDefault();
        onTabClose(tabId);
      }
    },
    [onTabClose],
  );

  return (
    <div className={styles.strip}>
      {/* Tabs */}
      {tabs.map((tab, i) => {
        const label = (tab as TabStripTab).label ?? tab.tabId;
        const active = tab.tabId === activeTabId;
        const width = layout.widths[i] ?? 120;

        return (
          <DropdownMenu key={tab.tabId}>
            <Tooltip content={tabTooltip(tab, label)} side="bottom">
              <div
                className={clsx(styles.tab, active && styles.tabActive)}
                style={{ width }}
                onClick={() => onTabSelect(tab.tabId)}
                onMouseDown={(e) => handleMouseDown(e, tab.tabId)}
                onContextMenu={(e) => e.preventDefault()}
                role="tab"
                aria-selected={active}
              >
                <TabIcon kind={tab.target.kind} />
                <span className={styles.tabLabel}>{label}</span>
                <button
                  className={styles.tabClose}
                  onClick={(e) => { e.stopPropagation(); onTabClose(tab.tabId); }}
                  aria-label="Close tab"
                >
                  <X size={10} />
                </button>
              </div>
            </Tooltip>
            <DropdownMenuTrigger asChild>
              <span />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {tabContextMenu({ tab, tabs, index: i, formFactor: "desktop" }).map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  disabled={item.disabled}
                  onSelect={() => onTabContextAction(tab.tabId, item.id)}
                >
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}

      {/* Trailing actions */}
      <div className={styles.trailing}>
        {trailing.map((action) => (
          <Tooltip key={action.id} content={action.tooltip} side="bottom">
            <button
              className={styles.trailingBtn}
              disabled={action.disabled}
              onClick={() => onTrailingAction(action.id)}
              aria-label={action.tooltip}
            >
              <Plus size={14} />
            </button>
          </Tooltip>
        ))}
      </div>

      {/* Pinned quick-launch */}
      {pins.length > 0 && (
        <div className={styles.pinned}>
          {pins.map((btn) => (
            <Tooltip key={btn.key} content={btn.label} side="bottom">
              <button
                className={styles.trailingBtn}
                onClick={() => onPinnedLaunch(btn)}
                aria-label={btn.label}
              >
                <TabIcon kind={btn.target.kind} />
              </button>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}
