/**
 * KeyboardShortcutsDialog — lists all bindings and supports per-binding overrides.
 * Consumes sprint-012 shortcuts registry + overrides store.
 * keyboard-shortcuts.md
 */

import styles from "./ShortcutsDialog.module.css";
import { AdaptiveSheet } from "../overlays/Dialog.js";
import { DEFAULT_BINDINGS, type ShortcutBinding } from "../../shortcuts/registry.js";
import { KeyboardShortcutOverridesStore } from "../../shortcuts/overrides-store.js";
import { formatCombo, type OsFamily } from "../../ui/shortcut.js";
import { type ShortcutSectionId } from "../../shortcuts/registry.js";

const SECTION_LABELS: Record<ShortcutSectionId, string> = {
  navigation: "Navigation",
  "tabs-panes": "Tabs & Panes",
  projects: "Projects",
  panels: "Panels",
  "agent-input": "Agent & Input",
};

export interface ShortcutsDialogProps {
  visible: boolean;
  onClose: () => void;
  os?: OsFamily;
  overridesStore?: KeyboardShortcutOverridesStore;
}

export function ShortcutsDialog({
  visible,
  onClose,
  os = "macos",
  overridesStore,
}: ShortcutsDialogProps) {
  // Group bindings by section.
  const bySection = new Map<ShortcutSectionId, ShortcutBinding[]>();
  for (const binding of DEFAULT_BINDINGS) {
    const section = binding.section;
    const list = bySection.get(section) ?? [];
    list.push(binding);
    bySection.set(section, list);
  }

  return (
    <AdaptiveSheet visible={visible} onClose={onClose} title="Keyboard Shortcuts" desktopMaxWidth={560}>
      {[...bySection.entries()].map(([section, bindings]) => (
        <div key={section} className={styles.section}>
          <div className={styles.sectionLabel}>{SECTION_LABELS[section]}</div>
          {bindings.map((binding) => {
            const override = overridesStore?.get(binding.id);
            const combo = override ?? (os === "macos" ? binding.mac : binding.nonMac);
            const formatted = formatCombo(combo, os);
            return (
              <div key={binding.id} className={styles.row}>
                <span className={styles.rowLabel}>{binding.labelKey}</span>
                <div className={styles.chips}>
                  {formatted.split(" ").map((chip, i) => (
                    <kbd key={i} className={styles.chip}>{chip}</kbd>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </AdaptiveSheet>
  );
}
