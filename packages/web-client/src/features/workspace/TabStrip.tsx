/**
 * TabStrip — dnd-kit sortable tab strip (POC `renderTabs`, POC_TO_APP_PLAN_UI.md §4.2).
 * Adds drag reorder (the POC couldn't reorder) + Radix Tooltip on truncated labels.
 */

import { MessageSquare, FileText, GitCompare, TerminalSquare, X } from "lucide-react";
import { clsx } from "clsx";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTabStore, type Tab, type TabKind } from "@pi-studio-ui/stores/tab-store.js";
import styles from "./TabStrip.module.css";

const ICON_BY_KIND: Record<TabKind, typeof MessageSquare> = {
  chat: MessageSquare,
  file: FileText,
  diff: GitCompare,
  terminal: TerminalSquare,
};

function TabItem({ tab }: { tab: Tab }) {
  const activeTabId = useTabStore((s) => s.activeTabId);
  const activate = useTabStore((s) => s.activate);
  const close = useTabStore((s) => s.close);
  const Icon = ICON_BY_KIND[tab.kind];

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
  });

  return (
    <div
      ref={setNodeRef}
      className={clsx(styles.tab, tab.id === activeTabId && styles.active)}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      onClick={() => activate(tab.id)}
      onAuxClick={(ev) => {
        if (ev.button === 1 && tab.closable) close(tab.id);
      }}
      title={tab.label}
      {...attributes}
      {...listeners}
    >
      <span className={styles.icon}>
        <Icon size={13} />
      </span>
      <span className={styles.label}>{tab.label}</span>
      {tab.closable && (
        <span
          className={styles.close}
          onClick={(ev) => {
            ev.stopPropagation();
            close(tab.id);
          }}
        >
          <X size={12} />
        </span>
      )}
    </div>
  );
}

export function TabStrip() {
  const tabs = useTabStore((s) => s.tabs);
  const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
  const reorder = useTabStore((s) => s.reorder);
  const visibleTabs = tabs.filter((t) => t.workspaceCwd === activeWorkspaceCwd);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    reorder(String(active.id), String(over.id));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={visibleTabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
        <div className={styles.strip}>
          {visibleTabs.map((tab) => (
            <TabItem key={tab.id} tab={tab} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
