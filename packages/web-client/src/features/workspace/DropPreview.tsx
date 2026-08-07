/**
 * Drag chrome for pane drops: the outcome preview and the floating drag chip.
 *
 * The preview is chrome, never a panel — it renders in `TabPanelHost`'s overlay layer beside the
 * dividers, never inside a panel, so it cannot affect panel mounting. Its box comes from
 * `pane-layout-view.dropPreviewStyle` and its region has already been degraded by
 * `pane-dnd.effectiveDropRegion`, which is what makes "the preview is always the outcome" true by
 * construction rather than by two agreeing checks.
 *
 * swe/features/workspace-split-panes.md § UI Behavior, § Drop regions
 */

import type { Tab } from "@pi-studio-ui/stores/tab-store.js";
import { ICON_BY_KIND } from "./TabStrip.js";
import { dropPreviewStyle } from "./pane-layout-view.js";
import type { DropRegion } from "./pane-dnd.js";
import type { Rect } from "./pane-tree.js";
import styles from "./DropPreview.module.css";

export function DropPreview({ rect, region }: { rect: Rect; region: DropRegion }) {
  return <div className={styles.preview} style={dropPreviewStyle(rect, region)} />;
}

/** Follows the pointer inside dnd-kit's `DragOverlay` — the dragged tab, detached from its strip. */
export function DragChip({ tab }: { tab: Tab }) {
  const Icon = ICON_BY_KIND[tab.kind];
  return (
    <div className={styles.chip}>
      <Icon size={13} />
      <span className={styles.chipLabel}>{tab.label}</span>
    </div>
  );
}
