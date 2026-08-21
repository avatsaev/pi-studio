/**
 * TabPanelHost — mounts one panel per open tab via `panel-registry`, keeps inactive panels
 * mounted but hidden (`display:none`), preserving scroll/terminal state across tab switches
 * exactly like the POC's DOM-persisted panels (POC_TO_APP_PLAN_UI.md §4.2), but through React
 * reconciliation instead of `data-tab-panel` querying. This now spans workspace switches too
 * (§4.7 follow-up: workspace-scoped tabs) — ALL tabs across every workspace stay mounted; only
 * the strip/empty-state visibility is workspace-scoped, so switching workspaces never tears down
 * a live terminal or loses scroll position in another workspace's tabs.
 *
 * **Flat host, computed rectangles** (workspace-split-panes.md § Panel continuity invariant). With
 * splits, panels are NOT nested into pane subtrees: every panel stays a direct child of this one
 * container for its tab's whole life, and a rearrangement changes only its `left/top/width/height`.
 * Re-parenting would remount it, and `TerminalPanel` kills its PTY on unmount — a dragged terminal
 * would lose its process. Panels are keyed by `tab.id` in one flat `tabs.map`, so React reconciles
 * them in place no matter how the tree changes.
 * Rects come from `paneRects(effectiveTree(...))` (via `pane-layout-view.ts`, where all of this
 * file's render decisions live so they are testable without jsdom) and stay **fractional**: they are
 * emitted as percentages, so the browser's own layout resolves them against the host box. No
 * `ResizeObserver` and no measured state here — a window resize or a divider drag re-lays-out
 * without React re-rendering, and size-sensitive panels (xterm's `FitAddon`) still see their own box
 * change through the observer they already own.
 *
 * Visibility is **per pane**: a pane's active tab is on screen even when another pane is focused, so
 * it cannot be `tab.id === activeTabId` any more.
 *
 * Two distinct empty states: no workspace open at all (`activeWorkspaceCwd === null`, with an
 * "Open Workspace" CTA) vs. a workspace in view with no tabs opened in it yet.
 */

import { Suspense, useMemo, useRef, type CSSProperties } from "react";
import { clsx } from "clsx";
import { FolderOpen } from "lucide-react";
import { DndContext, DragOverlay, useDroppable } from "@dnd-kit/core";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { useTabStore } from "@pi-studio-ui/stores/tab-store.js";
import { useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { usePaneDrag } from "@pi-studio-ui/hooks/use-pane-drag.js";
import { PANEL_BY_KIND } from "./panel-registry.js";
import {
  occupiedPaneRects,
  paneChrome,
  paneDividers,
  paneStyle,
  panelBoxes,
  resolveOwningPaneId,
} from "./pane-layout-view.js";
import { PaneDividers } from "./PaneDividers.js";
import { useExternalPaneDrop, paneDropProps } from "@pi-studio-ui/hooks/use-external-pane-drop.js";
import { DragChip, DropPreview } from "./DropPreview.js";
import { TabStrip } from "./TabStrip.js";
import { TabContextMenu } from "./TabContextMenu.js";
import styles from "./TabPanelHost.module.css";

/**
 * The drop target for a pane's body. Pointer-transparent: dnd-kit hit-tests pointer coordinates
 * against measured rects, so this zone needs a box but must not swallow clicks into the panel
 * beneath it. `paneDropProps` lets a native sidebar drag find the same box by measurement, since
 * `pointer-events: none` also means native drag events never target it directly.
 */
function PaneDropZone({ paneId, style }: { paneId: string; style: CSSProperties | undefined }) {
  const { setNodeRef } = useDroppable({ id: `pane:${paneId}`, data: { type: "pane", paneId } });
  return (
    <div ref={setNodeRef} className={styles.dropZone} style={style} {...paneDropProps(paneId)} />
  );
}

export function TabPanelHost() {
  const tabs = useTabStore((s) => s.tabs);
  const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
  const layout = useLayoutStore((s) =>
    activeWorkspaceCwd === null ? undefined : s.layouts[activeWorkspaceCwd],
  );
  const status = useConnectionStore((s) => s.status);
  const openCwdPicker = useUiStore((s) => s.openCwdPicker);
  const focusPane = useLayoutStore((s) => s.focusPane);
  const hasTabsInWorkspace = tabs.some((t) => t.workspaceCwd === activeWorkspaceCwd);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const boxes = useMemo(
    () => panelBoxes(tabs, activeWorkspaceCwd, layout),
    [tabs, activeWorkspaceCwd, layout],
  );
  const chrome = useMemo(() => paneChrome(layout), [layout]);
  const dividers = useMemo(() => paneDividers(layout), [layout]);
  const rects = useMemo(() => occupiedPaneRects(layout), [layout]);
  const drag = usePaneDrag(activeWorkspaceCwd);
  const externalDrop = useExternalPaneDrop(activeWorkspaceCwd, areaRef);
  // One preview slot: the two drag systems are mutually exclusive (a native drag never starts a
  // dnd-kit gesture), so whichever is live owns it.
  const preview = drag.preview ?? externalDrop.preview;

  // Both empty states are OVERLAYS, never an early return that would skip the panel list: every
  // panel must stay mounted for its tab's whole life, and a workspace can be brought into view
  // while it has no tabs of its own (another workspace's live terminal must survive that).
  return (
    <DndContext
      sensors={drag.sensors}
      collisionDetection={drag.collisionDetection}
      onDragStart={drag.onDragStart}
      onDragMove={drag.onDragMove}
      onDragEnd={drag.onDragEnd}
      onDragCancel={drag.onDragCancel}
    >
      <div
        className={styles.area}
        ref={areaRef}
        onDragOver={externalDrop.onDragOver}
        onDragLeave={externalDrop.onDragLeave}
        onDrop={externalDrop.onDrop}
      >
        {/* One strip per pane, or one inert strip when no workspace is open (same empty row as
          before panes existed). Strips are chrome — unlike panels, they may be created and
          destroyed freely, since nothing stateful is mounted inside one. */}
        {chrome.length === 0 ? (
          <TabStrip cwd={activeWorkspaceCwd} paneId={null} />
        ) : (
          chrome.map((pane) => (
            <TabStrip
              key={pane.paneId}
              cwd={activeWorkspaceCwd}
              paneId={pane.paneId}
              style={pane.stripStyle}
              focused={pane.focused}
            />
          ))
        )}
        {/* Once for the whole host, not once per strip — mirrors `SessionContextMenu`'s single
          mount inside `SessionList` (sprint-069/task-004). */}
        <TabContextMenu />
        {activeWorkspaceCwd !== null && dividers.length > 0 && (
          <PaneDividers cwd={activeWorkspaceCwd} dividers={dividers} hostRef={areaRef} />
        )}
        {/* Body drop zones and the outcome preview: chrome in the overlay layer, never inside a
          panel, so a drag can never affect panel mounting. */}
        {chrome.map((pane) => (
          <PaneDropZone
            key={`drop-${pane.paneId}`}
            paneId={pane.paneId}
            style={paneStyle(rects.get(pane.paneId))}
          />
        ))}
        {preview !== null && rects.has(preview.paneId) && (
          <DropPreview rect={rects.get(preview.paneId)!} region={preview.region} />
        )}
        {activeWorkspaceCwd === null && (
          <div className={styles.emptyStack}>
            <div className={styles.emptyTitle}>No workspace open</div>
            <div className={styles.emptyHint}>Open a project folder to start a chat.</div>
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<FolderOpen size={14} />}
              disabled={status !== "open"}
              title={status !== "open" ? "Connect to open a workspace" : "Open a workspace folder"}
              onClick={() => openCwdPicker()}
            >
              Open Workspace
            </Button>
          </div>
        )}
        {activeWorkspaceCwd !== null && !hasTabsInWorkspace && (
          <div className={styles.empty}>No open tabs in this workspace</div>
        )}
        {tabs.map((tab, i) => {
          const Panel = PANEL_BY_KIND[tab.kind];
          const box = boxes[i]!;
          const pane = layout?.placement[tab.id];
          return (
            <div
              key={tab.id}
              className={clsx(styles.panel, box.visible && styles.active)}
              style={box.style}
              // Clicking anywhere in a pane's body focuses it. Bubbling phase on purpose: an
              // interactive child that stops propagation (a menu, an overlay) keeps focus where it is.
              onPointerDown={() => {
                if (activeWorkspaceCwd !== null && pane !== undefined) {
                  focusPane(activeWorkspaceCwd, pane);
                }
              }}
            >
              <Suspense fallback={<Spinner size="md" />}>
                <Panel tab={tab} owningPaneId={resolveOwningPaneId(tab.id, layout)} />
              </Suspense>
            </div>
          );
        })}
      </div>
      <DragOverlay dropAnimation={null}>
        {drag.draggedTab && <DragChip tab={drag.draggedTab} />}
      </DragOverlay>
    </DndContext>
  );
}
