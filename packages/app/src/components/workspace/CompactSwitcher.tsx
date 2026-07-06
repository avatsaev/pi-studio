/**
 * CompactSwitcher — mobile/compact tab switcher (replaces multi-pane + tab strip).
 * workspace-ui.md § Mobile tab switcher
 */

import { useMemo } from "react";
import { X } from "lucide-react";
import { clsx } from "clsx";
import styles from "./CompactSwitcher.module.css";
import { Button } from "../primitives/index.js";
import {
  buildMobileSwitcher,
  type MobileSwitcherEntry,
} from "../../workspace/mobile-switcher.js";
import type { WorkspaceTab } from "../../workspace/tabs.js";
import type { PinnedTabTarget, QuickLaunchButton } from "../../workspace/pinned-targets.js";

export interface CompactSwitcherProps {
  tabs: readonly WorkspaceTab[];
  activeTabId?: string;
  pinnedTargets: readonly PinnedTabTarget[];
  nextDraftId: string;
  nextTerminalId: string;
  nextBrowserId: string;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNewTab: (button: QuickLaunchButton) => void;
}

export function CompactSwitcher({
  tabs,
  activeTabId,
  pinnedTargets,
  nextDraftId,
  nextTerminalId,
  nextBrowserId,
  onSelect,
  onClose,
  onNewTab,
}: CompactSwitcherProps) {
  const model = useMemo(
    () => buildMobileSwitcher({ tabs, activeTabId, pinnedTargets, nextDraftId, nextTerminalId, nextBrowserId }),
    [tabs, activeTabId, pinnedTargets, nextDraftId, nextTerminalId, nextBrowserId],
  );

  return (
    <div className={styles.container}>
      <div className={styles.list}>
        {model.entries.map((entry) => (
          <div
            key={entry.tabId}
            className={clsx(styles.entry, entry.active && styles.entryActive)}
            onClick={() => onSelect(entry.tabId)}
            role="button"
            tabIndex={0}
          >
            <span className={styles.entryLabel}>{entry.label}</span>
            {entry.closable && (
              <button
                className={styles.entryClose}
                onClick={(e) => { e.stopPropagation(); onClose(entry.tabId); }}
                aria-label="Close"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>

      {model.newTabActions.length > 0 && (
        <div className={styles.actions}>
          {model.newTabActions.map((btn) => (
            <Button key={btn.key} size="sm" variant="ghost" onClick={() => onNewTab(btn)}>
              {btn.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
