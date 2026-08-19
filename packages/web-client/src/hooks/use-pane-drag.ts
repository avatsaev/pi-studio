/**
 * The single drag gesture that spans every pane: reorder inside a strip, move to another strip, and
 * split by dropping on a pane body's edge.
 *
 * One `DndContext` (owned by `TabPanelHost`) is a hard requirement, not a preference — a gesture
 * cannot begin in one drag system and finish in another, so strips and bodies must be droppables of
 * the same context. This hook owns everything that context needs: sensors, collision ranking, the
 * live preview, and the drop dispatch.
 *
 * Three droppable kinds, ranked in that order by `collisionDetection`:
 *
 * |`data.type`|Registered by|Drop meaning|
 * |---|---|---|
 * |`tab`|`TabStrip`'s `useSortable`|move (if cross-pane) + reorder at that tab's position|
 * |`strip`|`TabStrip`'s `useDroppable`|move into that pane, appended last|
 * |`pane`|`TabPanelHost`'s body zone|edge → split; centre → move into the pane|
 *
 * The preview and the drop read ONE already-degraded region (`pane-dnd.effectiveDropRegion`), so what
 * the user sees is what happens — including when an illegal edge degrades to a whole-pane move.
 *
 * swe/features/workspace-split-panes.md § Drop regions, § Resolving a drop region,
 * § Splitting, § UI Behavior
 */

import { useCallback, useMemo, useState } from "react";
import {
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type SensorDescriptor,
  type SensorOptions,
} from "@dnd-kit/core";
import {
  effectiveDropRegion,
  isNoOpDrop,
  resolveDropRegion,
  type DropOutcome,
} from "@pi-studio-ui/features/workspace/pane-dnd.js";
import { armDragGuard, disarmDragGuard } from "@pi-studio-ui/lib/drag-guard.js";
import { useLayoutStore, type WorkspacePaneLayout } from "@pi-studio-ui/stores/layout-store.js";
import { useTabStore, type Tab } from "@pi-studio-ui/stores/tab-store.js";

type DropTargetKind = "tab" | "strip" | "pane";

/** Ranked most specific first: a tab sits inside a strip, so both contain the pointer. */
const TARGET_RANK: Readonly<Record<DropTargetKind, number>> = { tab: 0, strip: 1, pane: 2 };

interface DropTarget {
  kind: DropTargetKind;
  /** Set by the `strip` and `pane` droppables; a `tab` resolves its pane from `placement`. */
  paneId: string | null;
}

/**
 * Narrow a droppable's `data.current`. Ours to begin with (set by the strip/body droppables), but
 * dnd-kit types it loosely, so it is checked rather than asserted.
 */
function dropTarget(data: unknown): DropTarget | null {
  if (data === null || typeof data !== "object") return null;
  if (!("type" in data)) return null;
  const { type } = data;
  if (type !== "tab" && type !== "strip" && type !== "pane") return null;
  const paneId = "paneId" in data && typeof data.paneId === "string" ? data.paneId : null;
  return { kind: type, paneId };
}

export interface PaneDrag {
  sensors: SensorDescriptor<SensorOptions>[];
  collisionDetection: CollisionDetection;
  onDragStart(event: DragStartEvent): void;
  onDragMove(event: DragMoveEvent): void;
  onDragEnd(event: DragEndEvent): void;
  onDragCancel(): void;
  /** The tab being dragged, for the floating drag chip. */
  draggedTab: Tab | null;
  /** What the drop would do, or `null` when it would do nothing (no target, or a no-op drop). */
  preview: DropOutcome | null;
}

/** dnd-kit reports the activating event plus the accumulated delta; together they are the pointer. */
function pointerOf(event: DragMoveEvent | DragEndEvent): { x: number; y: number } | null {
  const activator = event.activatorEvent;
  if (!(activator instanceof MouseEvent)) return null; // PointerEvent extends MouseEvent
  return { x: activator.clientX + event.delta.x, y: activator.clientY + event.delta.y };
}

/** Which pane a non-body target belongs to: the strip's own pane, or the pane holding that tab. */
function paneOfTarget(
  target: DropTarget,
  overId: string,
  layout: WorkspacePaneLayout,
): string | null {
  return target.kind === "tab" ? (layout.placement[overId] ?? null) : target.paneId;
}

export function usePaneDrag(cwd: string | null): PaneDrag {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<DropOutcome | null>(null);
  const draggedTab = useTabStore((s) => s.tabs.find((t) => t.id === draggedId) ?? null);

  // Unchanged activation constraint: a plain click still activates a tab instead of starting a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const collisionDetection = useMemo<CollisionDetection>(
    () => (args) => {
      const ranked = pointerWithin(args)
        .map((hit) => ({
          hit,
          target: dropTarget(
            args.droppableContainers.find((container) => container.id === hit.id)?.data.current,
          ),
        }))
        .filter(
          (entry): entry is { hit: (typeof entry)["hit"]; target: DropTarget } =>
            entry.target !== null,
        )
        .toSorted((a, b) => TARGET_RANK[a.target.kind] - TARGET_RANK[b.target.kind]);
      // Empty means the pointer is over no target at all — releasing there changes nothing.
      return ranked.length === 0 ? [] : [ranked[0]!.hit];
    },
    [],
  );

  /** What a drop at the current pointer would do, or `null` when it would change nothing. */
  const resolveTarget = useCallback(
    (event: DragMoveEvent | DragEndEvent): DropOutcome | null => {
      const { over, active } = event;
      const target = dropTarget(over?.data.current);
      if (!over || target === null || cwd === null) return null;
      const layout = useLayoutStore.getState().layouts[cwd];
      if (layout === undefined) return null;
      const tabId = String(active.id);
      const overId = String(over.id);

      if (target.kind !== "pane") {
        // Strips and tabs carry no region: both are moves into the pane that owns them.
        const paneId = paneOfTarget(target, overId, layout);
        if (paneId === null || (target.kind === "tab" && overId === tabId)) return null;
        // A same-pane tab drop is a pure reorder — a real outcome, not a no-op.
        if (target.kind === "tab" && layout.placement[tabId] === paneId) {
          return { paneId, region: "center" };
        }
        return isNoOpDrop("center", paneId, tabId, layout.placement)
          ? null
          : { paneId, region: "center" };
      }

      const pointer = pointerOf(event);
      if (target.paneId === null || pointer === null) return null;
      const region = effectiveDropRegion(
        layout.tree,
        target.paneId,
        resolveDropRegion(pointer, over.rect),
      );
      return isNoOpDrop(region, target.paneId, tabId, layout.placement)
        ? null
        : { paneId: target.paneId, region };
    },
    [cwd],
  );

  const onDragStart = useCallback((event: DragStartEvent) => {
    // dnd-kit's sensor listens on the owner document and never captures the pointer, so a drag
    // crossing into a preview iframe would otherwise go silent — see `lib/drag-guard.ts`.
    armDragGuard();
    setDraggedId(String(event.active.id));
  }, []);

  const onDragMove = useCallback(
    (event: DragMoveEvent) => {
      const next = resolveTarget(event);
      // Only ever set a real change: this runs per pointer frame.
      setPreview((current) =>
        current?.paneId === next?.paneId && current?.region === next?.region ? current : next,
      );
    },
    [resolveTarget],
  );

  const onDragCancel = useCallback(() => {
    disarmDragGuard();
    setDraggedId(null);
    setPreview(null);
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      disarmDragGuard();
      setDraggedId(null);
      setPreview(null);
      const { active, over } = event;
      const target = dropTarget(over?.data.current);
      if (!over || target === null || cwd === null) return;

      const tabId = String(active.id);
      const layout = useLayoutStore.getState().layouts[cwd];
      if (layout === undefined) return;
      const tabStore = useTabStore.getState();
      const order = tabStore.tabs.filter((t) => t.workspaceCwd === cwd).map((t) => t.id);
      const { moveTab, splitWithTab } = useLayoutStore.getState();

      if (target.kind === "tab") {
        const overId = String(over.id);
        if (overId === tabId) return;
        const targetPane = layout.placement[overId];
        if (targetPane !== undefined && targetPane !== layout.placement[tabId]) {
          moveTab(cwd, tabId, targetPane, order);
        }
        // Landing at the target tab's position, within or across panes.
        tabStore.reorder(tabId, overId);
        return;
      }

      const resolved = resolveTarget(event);
      if (resolved === null) return;
      if (resolved.region !== "center") {
        splitWithTab(cwd, tabId, resolved.paneId, resolved.region, order);
        return;
      }

      moveTab(cwd, tabId, resolved.paneId, order);
      // "Appended last" in the receiving pane. Global order is the only order, so this is a reorder
      // past that pane's current last tab — and only when the tab is not already after it.
      const placement = useLayoutStore.getState().layouts[cwd]?.placement ?? {};
      const last = order.filter((id) => id !== tabId && placement[id] === resolved.paneId).at(-1);
      if (last !== undefined && order.indexOf(tabId) < order.indexOf(last)) {
        tabStore.reorder(tabId, last);
      }
    },
    [cwd, resolveTarget],
  );

  return {
    sensors,
    collisionDetection,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragCancel,
    draggedTab,
    preview,
  };
}
