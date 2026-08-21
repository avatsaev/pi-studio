/**
 * Per-tab context menu — Radix DropdownMenu anchored at cursor coordinates, following
 * `SessionContextMenu.tsx`'s established right-click pattern. Minimal by design (sprint-069/
 * task-004): a single "Close" action, existing so a tab still has a way to close once the
 * tight-strip rule has replaced its `×` with the needs-input dot (`TabStrip.module.css`'s
 * `@container` concession) — closing must never become unreachable just because a tab is narrow.
 *
 * `features/workspace-ui.md`'s § Desktop tab strip previously marked a per-tab context menu
 * "not implemented"; this is that menu, deliberately scoped to Close only rather than the fuller
 * reference-app set (Copy resume command, Rename, Close to the left/right, …) — those remain
 * unimplemented and undocumented as such, this task builds only the one action its own scope
 * requires.
 */

import { useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { X } from "lucide-react";
import {
  MenuCursorTrigger,
  MenuContent,
  MenuItem,
} from "@pi-studio-ui/components/primitives/Menu.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { closeTab } from "@pi-studio-ui/stores/tab-store.js";

export function TabContextMenu() {
  const menu = useUiStore((s) => s.tabMenu);
  const closeTabMenu = useUiStore((s) => s.closeTabMenu);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(menu !== null);
  }, [menu]);

  if (!menu) return null;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) closeTabMenu();
  }

  function close() {
    if (menu) closeTab(menu.tabId);
    closeTabMenu();
  }

  return (
    <DropdownMenu.Root open={open} onOpenChange={handleOpenChange} modal={false}>
      <DropdownMenu.Trigger asChild>
        <MenuCursorTrigger ref={triggerRef} x={menu.x} y={menu.y} />
      </DropdownMenu.Trigger>
      <MenuContent minWidth={120}>
        <MenuItem onSelect={close}>
          <X size={13} />
          Close
        </MenuItem>
      </MenuContent>
    </DropdownMenu.Root>
  );
}
