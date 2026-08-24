/**
 * ThinkingMenu — thinking-level selector trigger + anchored picker (sprint-070/task-005; the
 * "Thinking | brain-icon badge → levels combobox" row `composer-ui.md`'s controls table has
 * specified since sprint-015). Lives in the composer's bottom toolbar, mounted immediately
 * after `ModelMenu` in `.toolbarRight` (user-pinned placement, 2026-08-24).
 *
 * Deliberately leaner than `ModelMenu`: levels are one flat ordered list (≤7 rows), so there is
 * no search input and no grouping. Open state is CONTROLLED (like `CommandMenu`, unlike
 * `ModelMenu`) because the caller gates its live `agent_thinking_levels_request` query on the
 * menu being open — an uncontrolled menu would have no way to express that. The caller also
 * supplies the level list (live: `useThinkingLevels`, keyed `[agentId, model]`; draft: the
 * cached model catalogue via `thinking-level-source.ts`), and an empty list hides the whole
 * control. The popup reuses `ModelMenu.module.css`'s chrome (`.picker`/`.list`/`.item`/
 * `.checkSlot`/`.label`), the same cross-component reuse `CommandMenu` established.
 *
 * Anchoring follows `ModelMenu`'s visible-trigger pattern (`DropdownMenu.Trigger asChild`
 * wrapping a real button) with `align="end"` — same right-edge reasoning as the model trigger.
 * `side="top"` is EXPLICIT, not left to Radix's collision-based auto-flip: `ModelMenu`'s bulkier
 * popup (search input + rows) reliably overflows below the composer and gets auto-flipped, but
 * this popup's short ≤7-row (often 1-row-while-loading) content can "fit" in the sliver of space
 * below the toolbar and stay there — the same explicit-`side` fix `CommandMenu` already applies
 * for the identical composer-bottom position.
 */

import type { ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { MenuContent } from "@pi-studio-ui/components/primitives/Menu.js";
import modelMenuStyles from "./ModelMenu.module.css";

export interface ThinkingMenuProps {
  /** `session.thinkingLevel` — undefined until restored/broadcast/picked. */
  currentLevel?: string;
  /** The levels to offer — one flat ordered list, ≤7 rows. Empty ⇒ the caller hides us. */
  levels: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (level: string) => void;
  /** Renders the visible trigger element (must forward ref/props via `DropdownMenu.Trigger
   * asChild` — a real `<button>`). Receives the current level so the caller can render its own
   * label/placeholder styling. */
  renderTrigger: (currentLevel: string | undefined) => ReactNode;
}

export function ThinkingMenu({
  currentLevel,
  levels,
  open,
  onOpenChange,
  onSelect,
  renderTrigger,
}: ThinkingMenuProps) {
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenu.Trigger asChild>{renderTrigger(currentLevel)}</DropdownMenu.Trigger>
      <MenuContent
        minWidth={140}
        align="end"
        side="top"
        sideOffset={6}
        className={modelMenuStyles.picker}
      >
        {levels.length === 0 ? (
          <div className={modelMenuStyles.state}>Loading levels…</div>
        ) : (
          <div className={modelMenuStyles.list}>
            {levels.map((level) => (
              <DropdownMenu.Item
                key={level}
                className={modelMenuStyles.item}
                onSelect={() => onSelect(level)}
              >
                <span className={modelMenuStyles.checkSlot} aria-hidden>
                  {level === currentLevel && <Check size={14} />}
                </span>
                <span className={modelMenuStyles.label}>{level}</span>
              </DropdownMenu.Item>
            ))}
          </div>
        )}
      </MenuContent>
    </DropdownMenu.Root>
  );
}
