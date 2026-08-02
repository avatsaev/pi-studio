/**
 * TabStrip — dnd-kit sortable tab strip (POC `renderTabs`, POC_TO_APP_PLAN_UI.md §4.2).
 * Adds drag reorder (the POC couldn't reorder) + Radix Tooltip on truncated labels.
 */

import { MessageSquare, FileText, GitCompare, TerminalSquare, Atom, X, Plus } from "lucide-react";
import { clsx } from "clsx";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { MenuContent, MenuItem } from "@pi-studio-ui/components/primitives/Menu.js";
import { IconButton } from "@pi-studio-ui/components/primitives/IconButton.js";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useTabStore,
  openNewChat,
  openNewTerminal,
  openNewMolecule,
  closeTab,
  type Tab,
  type TabKind,
} from "@pi-studio-ui/stores/tab-store.js";
import styles from "./TabStrip.module.css";

const ICON_BY_KIND: Record<TabKind, typeof MessageSquare> = {
  chat: MessageSquare,
  file: FileText,
  diff: GitCompare,
  terminal: TerminalSquare,
  molecule: Atom,
};

function TabItem({ tab }: { tab: Tab }) {
  const activeTabId = useTabStore((s) => s.activeTabId);
  const activate = useTabStore((s) => s.activate);
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
        if (ev.button === 1 && tab.closable) closeTab(tab.id);
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
            closeTab(tab.id);
          }}
        >
          <X size={12} />
        </span>
      )}
    </div>
  );
}

/** Trailing "+" control — opens a new chat or terminal in the currently visible workspace.
 * Rendered as a sibling of `SortableContext`, not inside it, so it's never draggable/sortable
 * and reorder/`closestCenter` collision detection never sees it (GitHub issue #8). Orphaned
 * terminals (a PTY running on the daemon with no open tab) don't need a menu entry here — they're
 * auto-reopened as tabs by `use-terminal-restore.ts` on connect, the same way chat sessions are. */
function NewTabMenu({ workspaceCwd }: { workspaceCwd: string | null }) {
  const cwd = workspaceCwd ?? "~";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton
          className={styles.newTab}
          hoverBase="var(--pi-color-background)"
          style={{ borderRadius: "var(--pi-radius-sm)" }}
          title="New tab"
          disabled={!workspaceCwd}
        >
          <Plus size={14} />
        </IconButton>
      </DropdownMenu.Trigger>
      <MenuContent minWidth={160} sideOffset={4}>
        <MenuItem onSelect={() => openNewChat(cwd)}>
          <MessageSquare size={13} className={styles.itemIcon} />
          New chat
        </MenuItem>
        <MenuItem onSelect={() => openNewTerminal(cwd)}>
          <TerminalSquare size={13} className={styles.itemIcon} />
          New terminal
        </MenuItem>
        <MenuItem onSelect={() => openNewMolecule(cwd)}>
          <Atom size={13} className={styles.itemIcon} />
          New molecule view
        </MenuItem>
      </MenuContent>
    </DropdownMenu.Root>
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
    <div className={styles.strip}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={visibleTabs.map((t) => t.id)}
          strategy={horizontalListSortingStrategy}
        >
          {visibleTabs.map((tab) => (
            <TabItem key={tab.id} tab={tab} />
          ))}
        </SortableContext>
      </DndContext>
      <NewTabMenu workspaceCwd={activeWorkspaceCwd} />
    </div>
  );
}
