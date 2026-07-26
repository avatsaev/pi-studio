/**
 * CommandMenu — the `/` slash-command popup (web-client slash commands). Reuses `ModelMenu`'s
 * visual chrome (`ModelMenu.module.css`'s `.content`/`.list`/`.item`/`.label`/`.modelId`/`.state`/
 * `.stateError`) plus command-row-specific classes added to the same file
 * (`.commandContent`/`.commandItem`/`.commandItemHeader`/`.commandDescription` — a capped popup
 * width with the name and source badge on one line, description clamped to two lines below, full
 * text on hover via the native `title` attribute) — but this is a DIFFERENT component, not a
 * generalized `ModelMenu`: `ModelMenu` owns its `open`/`query` state privately and renders its own
 * search `<input>`, neither of which fits a menu whose open state and filter query are driven
 * entirely by the composer's own textarea.
 *
 * Rows are plain `<div role="option">`, not `DropdownMenu.Item` — `Item` brings Radix roving
 * focus/typeahead, which would fight the textarea for keyboard focus. `.itemActive` (keyboard
 * selection — what Enter/Tab applies) comes purely from `highlightedIndex`, driven by the
 * composer's own `ArrowUp`/`ArrowDown` handling; mouse hover is deliberately a SEPARATE, native
 * CSS `:hover` (see `.commandItem:hover` in `ModelMenu.module.css`) rather than being synced into
 * the same state via `onMouseEnter` — that would add a React round-trip to something the browser
 * already tracks natively, and can miss fast pointer movement.
 * `onOpenAutoFocus` is prevented so opening the menu (by clicking the trigger, or by typing `/`)
 * never steals focus away from the textarea — the user must be able to keep typing.
 */

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { clsx } from "clsx";
import { useEffect, useRef, type ReactNode } from "react";
import { Spinner } from "@pi-studio-ui/components/primitives/Spinner.js";
import type { ComboboxOption } from "@pi-studio-ui/ui/combobox.js";
import styles from "./ModelMenu.module.css";

/**
 * `onOpenAutoFocus` prevents Radix from auto-focusing the menu on open (needed so opening it —
 * by clicking the trigger, or by typing `/` — never steals focus away from the textarea, which
 * must be able to keep receiving keystrokes). It's real and runtime-forwarded — `MenuContentImpl`
 * destructures and composes it (`@radix-ui/react-menu`'s `dist/index.mjs`) — but Radix's PUBLIC
 * `DropdownMenuContentProps` type deliberately omits it (it's typed as
 * `MenuContentImplPrivateProps`, i.e. intentionally internal-API-only), so passing it as a plain
 * JSX attribute fails the excess-property check. Spreading a separately-typed object (rather than
 * inlining the prop) sidesteps that check honestly, without widening `DropdownMenu.Content`'s
 * props type as a whole.
 */
const preventOpenAutoFocus: { onOpenAutoFocus: (event: Event) => void } = {
  onOpenAutoFocus: (event) => event.preventDefault(),
};

/** Distinct color per command source so the three kinds read apart at a glance, not just by
 * their (tiny) label text — unmapped/future kinds fall back to `.commandKindBadge`'s own
 * neutral border/text color. */
function kindBadgeClass(kind: string): string | undefined {
  switch (kind) {
    case "extension":
      return styles.commandKindExtension;
    case "prompt":
      return styles.commandKindPrompt;
    case "skill":
      return styles.commandKindSkill;
    default:
      return undefined;
  }
}

export interface CommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rows to render, already filtered + ordered by the caller (`slash-commands.ts`). */
  options: ComboboxOption<string>[];
  /** Index into `options`; the row rendered as preselected. -1 for none. */
  highlightedIndex: number;
  onSelect: (name: string) => void;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  /** Count of extension commands hidden because a turn is running; 0 renders no note. */
  hiddenExtensionCount: number;
  renderTrigger: () => ReactNode;
}

export function CommandMenu({
  open,
  onOpenChange,
  options,
  highlightedIndex,
  onSelect,
  isLoading,
  isError,
  errorMessage,
  hiddenExtensionCount,
  renderTrigger,
}: CommandMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keyboard nav (composer's ArrowUp/ArrowDown) moves `highlightedIndex` without touching scroll
  // — the list's own `overflow-y: auto` never follows it on its own, so a highlighted row outside
  // the visible 320px window stayed invisible until scrolled manually. `"nearest"` only scrolls
  // when the row is actually out of view, so it doesn't jitter while the row is already visible.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, highlightedIndex]);

  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenu.Trigger asChild>{renderTrigger()}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={clsx(styles.content, styles.commandContent)}
          align="start"
          side="top"
          sideOffset={4}
          {...preventOpenAutoFocus}
          // Radix returns focus to the trigger button when the menu closes by default — that
          // would undo `applySelectedCommand`'s explicit `el.focus()` back onto the textarea
          // (Escape-to-close and click-away-to-close both go through this same path too), so the
          // textarea must own focus after ANY close, not just the apply path.
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {isLoading && (
            <div className={styles.state}>
              <Spinner size="sm" />
            </div>
          )}
          {!isLoading && isError && (
            <div className={styles.stateError}>{errorMessage ?? "Failed to load commands"}</div>
          )}
          {!isLoading && !isError && options.length === 0 && (
            <div className={styles.state}>No commands found</div>
          )}
          {!isLoading && !isError && options.length > 0 && (
            <div ref={listRef} className={clsx(styles.list, styles.commandList)}>
              {options.map((opt, i) => (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={i === highlightedIndex}
                  className={clsx(
                    styles.item,
                    styles.commandItem,
                    i === highlightedIndex && styles.itemActive,
                  )}
                  // Native title tooltip (the app's established hover-text convention, e.g.
                  // Composer.tsx's icon buttons) shows the FULL description on hover — the row
                  // itself only ever renders a 2-line clamp.
                  title={opt.description}
                  onMouseDown={(e) => {
                    // Keep the textarea's focus/caret through the click — this menu never takes
                    // keyboard focus, so a default mousedown would blur the textarea for nothing.
                    e.preventDefault();
                    onSelect(opt.value);
                  }}
                >
                  <div className={styles.commandItemHeader}>
                    <span className={styles.label}>{opt.label}</span>
                    {opt.kind && (
                      <span className={clsx(styles.commandKindBadge, kindBadgeClass(opt.kind))}>
                        {opt.kind}
                      </span>
                    )}
                  </div>
                  {opt.description && (
                    <div className={styles.commandDescription}>{opt.description}</div>
                  )}
                </div>
              ))}
            </div>
          )}
          {!isLoading && !isError && hiddenExtensionCount > 0 && (
            <div className={styles.state}>
              {hiddenExtensionCount} extension command(s) unavailable while the agent is running
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
