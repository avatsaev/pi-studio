/**
 * PaneTree — recursive split renderer with resizable dividers and focus.
 * workspace-ui.md § Panes & splits
 */

import { useCallback, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import styles from "./PaneTree.module.css";
import {
  type SplitNode,
  type SplitPane,
  type SplitGroup,
  type SplitDirection,
  MIN_SPLIT_SIZE,
} from "../../workspace/layout.js";
import { mountedTabState, mountedHiddenStyle } from "../../workspace/keepalive.js";

// ---------------------------------------------------------------------------
// Resize divider
// ---------------------------------------------------------------------------

function ResizeDivider({
  direction,
  onResize,
}: {
  direction: SplitDirection;
  onResize: (delta: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const startRef = useRef(0);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    startRef.current = direction === "row" ? e.clientX : e.clientY;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const current = direction === "row" ? e.clientX : e.clientY;
    const delta = current - startRef.current;
    if (Math.abs(delta) > 2) {
      onResize(delta);
      startRef.current = current;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  return (
    <div
      className={clsx(
        styles.divider,
        direction === "row" ? styles.dividerRow : styles.dividerColumn,
        dragging && styles.dividerActive,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  );
}

// ---------------------------------------------------------------------------
// PaneTree
// ---------------------------------------------------------------------------

export interface PaneTreeProps {
  root: SplitNode;
  focusedPaneId: string;
  activeTabIds: Record<string, string | undefined>;
  mountedLru: readonly string[];
  onPaneFocus: (paneId: string) => void;
  onResize: (groupId: string, sizes: number[]) => void;
  /** Render the panel body for a given tabId. */
  renderPanelBody: (tabId: string, paneId: string) => ReactNode;
}

export function PaneTree({
  root,
  focusedPaneId,
  activeTabIds,
  mountedLru,
  onPaneFocus,
  onResize,
  renderPanelBody,
}: PaneTreeProps) {
  return <NodeRenderer node={root} focusedPaneId={focusedPaneId} activeTabIds={activeTabIds} mountedLru={mountedLru} onPaneFocus={onPaneFocus} onResize={onResize} renderPanelBody={renderPanelBody} />;
}

function NodeRenderer({
  node,
  focusedPaneId,
  activeTabIds,
  mountedLru,
  onPaneFocus,
  onResize,
  renderPanelBody,
}: {
  node: SplitNode;
  focusedPaneId: string;
  activeTabIds: Record<string, string | undefined>;
  mountedLru: readonly string[];
  onPaneFocus: (paneId: string) => void;
  onResize: (groupId: string, sizes: number[]) => void;
  renderPanelBody: (tabId: string, paneId: string) => ReactNode;
}) {
  if (node.kind === "pane") {
    return (
      <LeafPane
        pane={node}
        focused={node.id === focusedPaneId}
        activeTabId={activeTabIds[node.id]}
        mountedLru={mountedLru}
        onFocus={() => onPaneFocus(node.id)}
        renderPanelBody={renderPanelBody}
      />
    );
  }

  return (
    <GroupRenderer
      group={node}
      focusedPaneId={focusedPaneId}
      activeTabIds={activeTabIds}
      mountedLru={mountedLru}
      onPaneFocus={onPaneFocus}
      onResize={onResize}
      renderPanelBody={renderPanelBody}
    />
  );
}

function GroupRenderer({
  group,
  focusedPaneId,
  activeTabIds,
  mountedLru,
  onPaneFocus,
  onResize,
  renderPanelBody,
}: {
  group: SplitGroup;
  focusedPaneId: string;
  activeTabIds: Record<string, string | undefined>;
  mountedLru: readonly string[];
  onPaneFocus: (paneId: string) => void;
  onResize: (groupId: string, sizes: number[]) => void;
  renderPanelBody: (tabId: string, paneId: string) => ReactNode;
}) {
  const handleResize = useCallback(
    (index: number, deltaPx: number) => {
      // Approximate: convert delta to fraction based on a reference size.
      const fraction = deltaPx / 600;
      const newSizes = [...group.sizes];
      const a = newSizes[index] ?? 0.5;
      const b = newSizes[index + 1] ?? 0.5;
      const next = Math.max(MIN_SPLIT_SIZE, Math.min(a + b - MIN_SPLIT_SIZE, a + fraction));
      newSizes[index] = next;
      newSizes[index + 1] = a + b - next;
      onResize(group.id, newSizes);
    },
    [group.id, group.sizes, onResize],
  );

  return (
    <div className={clsx(styles.group, group.direction === "row" ? styles.groupRow : styles.groupColumn)}>
      {group.children.map((child, i) => (
        <div key={child.id} style={{ flex: group.sizes[i] ?? 1 }}>
          <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: group.direction === "row" ? "row" : "column" }}>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <NodeRenderer node={child} focusedPaneId={focusedPaneId} activeTabIds={activeTabIds} mountedLru={mountedLru} onPaneFocus={onPaneFocus} onResize={onResize} renderPanelBody={renderPanelBody} />
            </div>
            {i < group.children.length - 1 && (
              <ResizeDivider direction={group.direction} onResize={(delta) => handleResize(i, delta)} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function LeafPane({
  pane,
  focused,
  activeTabId,
  mountedLru,
  onFocus,
  renderPanelBody,
}: {
  pane: SplitPane;
  focused: boolean;
  activeTabId: string | undefined;
  mountedLru: readonly string[];
  onFocus: () => void;
  renderPanelBody: (tabId: string, paneId: string) => ReactNode;
}) {
  return (
    <div
      className={clsx(styles.pane, focused && styles.paneFocused)}
      onClick={onFocus}
      style={{ width: "100%", height: "100%" }}
    >
      <div className={styles.paneBody}>
        {/* Keepalive: render active + LRU tabs, hide non-active */}
        {pane.tabIds.map((tabId) => {
          const state = mountedTabState(tabId, activeTabId, mountedLru);
          if (state === "unmounted") return null;
          const style = mountedHiddenStyle(state);
          return (
            <div key={tabId} style={style as any} aria-hidden={state !== "active"}>
              {renderPanelBody(tabId, pane.id)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
