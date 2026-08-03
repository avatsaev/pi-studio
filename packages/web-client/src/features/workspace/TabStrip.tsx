/**
 * TabStrip — dnd-kit sortable tab strip (POC `renderTabs`, POC_TO_APP_PLAN_UI.md §4.2).
 * Adds drag reorder (the POC couldn't reorder) + Radix Tooltip on truncated labels.
 *
 * **Pane-scoped since sprint-049.** One strip per rendered pane, absolutely positioned across the
 * top of its pane's rect by `TabPanelHost` (a pane's rect = strip row + panel body). It shows the
 * global tab order filtered to its own pane, highlights *its* pane's active tab — not the
 * workspace-active one — and its "+" opens into itself. With a single pane this is pixel-identical
 * to the one global strip it replaced: same height, same position, no focus indicator.
 *
 * The `DndContext` lives in `TabPanelHost` (one context spanning every strip and body — a single
 * gesture cannot start in one drag system and finish in another), so this file owns only its own
 * `SortableContext` plus a strip-level droppable for "dropped on the strip, not on a tab".
 *
 * `paneId`/`cwd` are nullable for exactly one case: no workspace open at all, where the strip still
 * renders as an empty row with a disabled "+" exactly as before.
 */

import type { CSSProperties } from "react";
import {
  MessageSquare,
  FileText,
  GitCompare,
  TerminalSquare,
  Atom,
  X,
  Plus,
  Columns2,
  Rows2,
} from "lucide-react";
import { clsx } from "clsx";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useDroppable } from "@dnd-kit/core";
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
import { useLayoutStore } from "@pi-studio-ui/stores/layout-store.js";
import { canSplit, type SplitRegion } from "./pane-tree.js";
import styles from "./TabStrip.module.css";

export const ICON_BY_KIND: Record<TabKind, typeof MessageSquare> = {
  chat: MessageSquare,
  file: FileText,
  diff: GitCompare,
  terminal: TerminalSquare,
  molecule: Atom,
};

function TabItem({ tab, active }: { tab: Tab; active: boolean }) {
  const activate = useTabStore((s) => s.activate);
  const Icon = ICON_BY_KIND[tab.kind];

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tab.id,
    data: { type: "tab" },
  });

  return (
    <div
      ref={setNodeRef}
      className={clsx(styles.tab, active && styles.active)}
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

/** Trailing "+" control — opens a new chat/terminal/molecule in **this pane**.
 * Rendered as a sibling of `SortableContext`, not inside it, so it's never draggable/sortable
 * and reorder/`closestCenter` collision detection never sees it (GitHub issue #8). Orphaned
 * terminals (a PTY running on the daemon with no open tab) don't need a menu entry here — they're
 * auto-reopened as tabs by `use-terminal-restore.ts` on connect, the same way chat sessions are.
 *
 * The target pane is passed explicitly rather than relying on "the focused pane wins", so a menu
 * click can never race focus. */
function NewTabMenu({
  workspaceCwd,
  paneId,
}: {
  workspaceCwd: string | null;
  paneId: string | null;
}) {
  const openInPane = (open: (cwd: string, targetPaneId?: string) => void) => () => {
    // Guarded rather than defaulted: a `?? "~"` fallback here would silently open a chat in a
    // phantom workspace (AGENTS.md § Invariants "Zero agents on connect ⇒ no workspace").
    if (workspaceCwd === null) return;
    open(workspaceCwd, paneId ?? undefined);
  };
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
        <MenuItem onSelect={openInPane(openNewChat)}>
          <MessageSquare size={13} className={styles.itemIcon} />
          New chat
        </MenuItem>
        <MenuItem onSelect={openInPane(openNewTerminal)}>
          <TerminalSquare size={13} className={styles.itemIcon} />
          New terminal
        </MenuItem>
        <MenuItem onSelect={openInPane(openNewMolecule)}>
          <Atom size={13} className={styles.itemIcon} />
          New molecule view
        </MenuItem>
      </MenuContent>
    </DropdownMenu.Root>
  );
}

/**
 * Split right / Split down on this pane, seeding the new pane with a fresh chat.
 *
 * A pane with no tabs cannot exist at rest (the assignment invariant collapses it), so the split and
 * the seed are one action: `splitEmpty` then `openNewChat` into the pane it returned. `openNewChat`
 * is this client's closest thing to a draft tab, and it opens synchronously even offline (its
 * server-side record is best-effort), so the new pane is never left empty.
 *
 * Unlike a drag, a programmatic split NEVER degrades: when `canSplit` is false for that region the
 * button is disabled with a reason. A button that quietly does something other than its label is
 * worse than one that is greyed out.
 */
function SplitActions({ cwd, paneId }: { cwd: string | null; paneId: string | null }) {
  const tree = useLayoutStore((s) => (cwd === null ? undefined : s.layouts[cwd]?.tree));

  const split = (region: SplitRegion) => () => {
    if (cwd === null || paneId === null) return;
    const created = useLayoutStore.getState().splitEmpty(cwd, paneId, region);
    if (created !== null) openNewChat(cwd, created);
  };
  /** `null` when the split is allowed; otherwise why not — the disabled button's tooltip. A pane
   * that cannot split because no workspace is open must not claim it hit the depth cap. */
  const refusal = (region: SplitRegion): string | null => {
    if (tree === undefined || paneId === null) return "Open a workspace to split";
    return canSplit(tree, paneId, region) ? null : "Maximum split depth reached";
  };
  const rightRefusal = refusal("right");
  const downRefusal = refusal("bottom");

  return (
    <>
      <IconButton
        className={styles.splitAction}
        hoverBase="var(--pi-color-background)"
        style={{ borderRadius: "var(--pi-radius-sm)" }}
        title={rightRefusal ?? "Split right"}
        disabled={rightRefusal !== null}
        onClick={split("right")}
      >
        <Columns2 size={14} />
      </IconButton>
      <IconButton
        className={styles.splitAction}
        hoverBase="var(--pi-color-background)"
        style={{ borderRadius: "var(--pi-radius-sm)" }}
        title={downRefusal ?? "Split down"}
        disabled={downRefusal !== null}
        onClick={split("bottom")}
      >
        <Rows2 size={14} />
      </IconButton>
    </>
  );
}

export interface TabStripProps {
  /** `null` only when no workspace is open. */
  cwd: string | null;
  /** `null` only when no workspace is open. */
  paneId: string | null;
  /** Absolute position across the top of the pane's rect, from `pane-layout-view.paneChrome`. */
  style?: CSSProperties;
  /** Show the focused-pane indicator (never with a single pane). */
  focused?: boolean;
}

export function TabStrip({ cwd, paneId, style, focused = false }: TabStripProps) {
  const tabs = useTabStore((s) => s.tabs);
  const focusPane = useLayoutStore((s) => s.focusPane);
  const placement = useLayoutStore((s) => (cwd === null ? undefined : s.layouts[cwd]?.placement));
  const activeInPane = useLayoutStore((s) =>
    cwd === null || paneId === null ? undefined : s.layouts[cwd]?.activeByPane[paneId],
  );
  // Global tab order filtered by pane membership — a pane owns no order of its own, so reorder stays
  // `tab-store.reorder` and there is no second order to drift.
  const paneTabs = paneId === null ? [] : tabs.filter((t) => placement?.[t.id] === paneId);
  // Dropping on the strip but not on a tab moves the tab into this pane, appended last.
  const { setNodeRef } = useDroppable({
    id: `strip:${paneId ?? "none"}`,
    disabled: paneId === null,
    data: { type: "strip", paneId },
  });

  return (
    <div
      ref={setNodeRef}
      className={clsx(styles.strip, styles.paneStrip, focused && styles.focused)}
      style={style}
      onPointerDown={() => {
        if (cwd !== null && paneId !== null) focusPane(cwd, paneId);
      }}
    >
      <div className={styles.tabs}>
        <SortableContext items={paneTabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
          {paneTabs.map((tab) => (
            <TabItem key={tab.id} tab={tab} active={tab.id === activeInPane} />
          ))}
        </SortableContext>
      </div>
      <NewTabMenu workspaceCwd={cwd} paneId={paneId} />
      <SplitActions cwd={cwd} paneId={paneId} />
    </div>
  );
}
