/**
 * ShortcutHint — displays keyboard shortcut chip(s).
 * ui-components.md § Shortcut
 */

import styles from "./Shortcut.module.css";
import { formatCombo, formatChord, type OsFamily } from "@pi-studio-ui/ui/shortcut.js";

export interface ShortcutProps {
  /** A single combo string e.g. "cmd+k". */
  combo?: string;
  /** A sequence of combos e.g. ["cmd+k", "cmd+s"]. */
  chord?: string[];
  os?: OsFamily;
  className?: string;
}

export function ShortcutHint({ combo, chord, os = "macos", className }: ShortcutProps) {
  const formatted = chord ? formatChord(chord, os) : combo ? formatCombo(combo, os) : "";

  if (!formatted) return null;

  // Split by spaces to render each chunk as a separate chip.
  const chips = formatted.split(" ").filter(Boolean);

  return (
    <span
      className={`${styles.row}${className ? ` ${className}` : ""}`}
      aria-label={formatted}
      role="presentation"
    >
      {chips.map((chip, i) => (
        <kbd key={i} className={styles.chip}>
          {chip}
        </kbd>
      ))}
    </span>
  );
}
