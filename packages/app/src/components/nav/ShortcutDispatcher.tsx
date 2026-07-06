/**
 * ShortcutDispatcher — global keyboard event listener that routes key combos
 * to the shortcut registry. Mount once at the app root.
 * keyboard-shortcuts.md § Dispatch
 */

import { useEffect, useCallback } from "react";
import {
  dispatchShortcut,
  getShortcutPlatform,
  resolveKeyboardFocusScope,
  normalizeCombo,
  type OverrideMap,
} from "../../shortcuts/dispatcher.js";
import { DEFAULT_BINDINGS } from "../../shortcuts/registry.js";

export type ShortcutActionHandler = (actionId: string) => void;

export interface ShortcutDispatcherProps {
  /** Called whenever a bound shortcut is fired. */
  onAction: ShortcutActionHandler;
  /** Whether the command center is currently open (affects focus-scope). */
  commandCenterOpen?: boolean;
  /** Override map from the KeyboardShortcutOverridesStore. */
  overrides?: OverrideMap;
  disabled?: boolean;
}

export function ShortcutDispatcher({
  onAction,
  commandCenterOpen = false,
  overrides = {},
  disabled = false,
}: ShortcutDispatcherProps) {
  const platform = getShortcutPlatform();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (disabled) return;

      const target = e.target as HTMLElement | null;

      // Ignore bare modifier presses.
      if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) return;

      const parts: string[] = [];
      if (e.metaKey) parts.push("cmd");
      if (e.ctrlKey) parts.push("ctrl");
      if (e.altKey) parts.push("alt");
      if (e.shiftKey) parts.push("shift");
      parts.push(e.key.toLowerCase());
      const combo = normalizeCombo(parts.join("+"));

      const scope = resolveKeyboardFocusScope({
        target: target as any,
        commandCenterOpen,
      });

      const result = dispatchShortcut(combo, scope, platform, DEFAULT_BINDINGS, overrides);

      if (result.matched) {
        e.preventDefault();
        onAction(result.action);
      }
    },
    [disabled, commandCenterOpen, overrides, platform, onAction],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Renders nothing; just a side-effect component.
  return null;
}
