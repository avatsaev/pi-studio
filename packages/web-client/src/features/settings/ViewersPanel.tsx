/**
 * ViewersPanel — the Settings dialog's Viewers category (sprint-073/task-006). Lists the fixed,
 * hardcoded set of registered viewer plugins — today, exactly one: Molecule Viewer. Hardcoding
 * this single row is deliberate; phase 4 of the decoupling plan (docs/MOLVIEWER_DECOUPLING.md)
 * makes it registry-driven once a real plugin registry exists, and building that now would be
 * speculative.
 *
 * Capability-independent category — `SETTINGS_CATEGORIES`'s entry for this panel is
 * `available: () => true`, so it always renders regardless of what the daemon advertises. Against
 * a daemon that does NOT advertise `viewerSettings`, the row still renders, just disabled and
 * reading on, with a note — the same degrade shape the capability-gated Model Providers category
 * uses, never a hidden row. `isViewerEnabled` already defaults an unhydrated/capability-free
 * document to "on" (viewer-settings-store.ts), so no separate "force checked" branch is needed
 * here — `enabled` already reads `true` whenever `capable` is `false`.
 */

import { Switch } from "@pi-studio-ui/components/primitives/Switch.js";
import { useViewerSettingsStore } from "@pi-studio-ui/viewer-plugins/viewer-settings-store.js";
import styles from "./ViewersPanel.module.css";

export function ViewersPanel() {
  const capable = useViewerSettingsStore((s) => s.capable);
  const enabled = useViewerSettingsStore((s) => s.isViewerEnabled("molviewer"));
  const setEnabled = useViewerSettingsStore((s) => s.setEnabled);

  return (
    <div className={styles.list}>
      <div className={styles.row}>
        <div className={styles.rowMain}>
          <span className={styles.name}>Molecule Viewer</span>
          <span className={styles.description}>
            Open molecular structure files (.cif, .pdb, .xyz, and similar) in the 3D viewer instead
            of as plain text.
          </span>
        </div>
        <Switch
          checked={enabled}
          disabled={!capable}
          onCheckedChange={(next) => void setEnabled("molviewer", next)}
          aria-label="Molecule Viewer"
        />
      </div>
      {!capable && <p className={styles.note}>Requires a newer daemon.</p>}
    </div>
  );
}
