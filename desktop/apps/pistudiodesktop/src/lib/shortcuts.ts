// Shortcuts arrive parsed, as data in the menus (crates/shell/src/shortcuts.rs). This file only
// compares them with key events and formats them for display.

import type { Menu, Shortcut } from "./types";

export function isMac(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.userAgent);
}

/** Exact match: an extra modifier is a different shortcut, so `Cmd+Shift+Z` never runs `Cmd+Z`. */
export function matches(shortcut: Shortcut, event: KeyboardEvent, mac: boolean): boolean {
  const ctrl = mac ? shortcut.ctrl : shortcut.cmd || shortcut.ctrl;
  const meta = mac ? shortcut.cmd : false;
  return (
    event.ctrlKey === ctrl &&
    event.metaKey === meta &&
    event.shiftKey === shortcut.shift &&
    event.altKey === shortcut.alt &&
    event.key.toLowerCase() === shortcut.key
  );
}

/** Keys a text field must keep while it has the focus: undo, redo, select all, clipboard. */
function editsText(event: KeyboardEvent): boolean {
  const target = event.target;
  const editable =
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit"].includes(target.type)) ||
    (target instanceof HTMLElement && target.isContentEditable);
  return editable && (event.ctrlKey || event.metaKey) && !event.altKey && "zyacvx".includes(event.key.toLowerCase());
}

/** The id of the command whose shortcut this key event is, if any. */
export function findShortcut(menus: Menu[], event: KeyboardEvent, mac: boolean): string | null {
  if (editsText(event)) {
    return null;
  }
  for (const menu of menus) {
    for (const item of menu.items) {
      if (item.shortcut && matches(item.shortcut, event, mac)) {
        return item.id;
      }
    }
  }
  return null;
}

function keyLabel(key: string): string {
  if (key === " ") {
    return "Space";
  }
  return key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
}

/** `⇧⌘Z` on macOS, `Ctrl+Shift+Z` elsewhere. */
export function formatShortcut(shortcut: Shortcut, mac: boolean): string {
  const key = keyLabel(shortcut.key);
  if (mac) {
    return `${shortcut.ctrl ? "⌃" : ""}${shortcut.alt ? "⌥" : ""}${shortcut.shift ? "⇧" : ""}${shortcut.cmd ? "⌘" : ""}${key}`;
  }
  const parts = [shortcut.cmd || shortcut.ctrl ? "Ctrl" : "", shortcut.alt ? "Alt" : "", shortcut.shift ? "Shift" : "", key];
  return parts.filter(Boolean).join("+");
}
