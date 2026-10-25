/**
 * ViewersPanel — the Settings dialog's Viewers category (sprint-073/task-006, extended by
 * sprint-078 with the PDF Viewer). Lists the fixed, hardcoded set of switchable viewers — a small
 * constant table, not a registry: phase 4 of the decoupling plan (docs/MOLVIEWER_DECOUPLING.md)
 * makes it registry-driven once a real plugin registry exists, and building that now would be
 * speculative. Each `id` is the viewer-settings row its dispatch point reads through
 * `isViewerEnabled` (molviewer: `open-file-tab.ts`; pdfviewer: the registry descriptor `toggle`).
 *
 * Capability-independent category — `SETTINGS_CATEGORIES`'s entry for this panel is
 * `available: () => true`, so it always renders regardless of what the daemon advertises. Against
 * a daemon that does NOT advertise `viewerSettings`, the rows still render, just disabled and
 * reading on, with a note — the same degrade shape the capability-gated Model Providers category
 * uses, never a hidden row. `isViewerEnabled` already defaults an unhydrated/capability-free
 * document to "on" (viewer-settings-store.ts), so no separate "force checked" branch is needed
 * here — `enabled` already reads `true` whenever `capable` is `false`.
 */

import { Switch } from "@pi-studio-ui/components/primitives/Switch.js";
import { useViewerSettingsStore } from "@pi-studio-ui/viewer-plugins/viewer-settings-store.js";
import styles from "./ViewersPanel.module.css";

const VIEWER_ROWS = [
  {
    id: "molviewer",
    name: "Molecule Viewer",
    description:
      "Open molecular structure files (.cif, .pdb, .xyz, and similar) in the 3D viewer instead of as plain text.",
  },
  {
    id: "pdfviewer",
    name: "PDF Viewer",
    description: "Render PDF files in place instead of offering only a download.",
  },
] as const;

function ViewerRow({ id, name, description }: (typeof VIEWER_ROWS)[number]) {
  const capable = useViewerSettingsStore((s) => s.capable);
  const enabled = useViewerSettingsStore((s) => s.isViewerEnabled(id));
  const setEnabled = useViewerSettingsStore((s) => s.setEnabled);

  return (
    <div className={styles.row}>
      <div className={styles.rowMain}>
        <span className={styles.name}>{name}</span>
        <span className={styles.description}>{description}</span>
      </div>
      <Switch
        checked={enabled}
        disabled={!capable}
        onCheckedChange={(next) => void setEnabled(id, next)}
        aria-label={name}
      />
    </div>
  );
}

export function ViewersPanel() {
  const capable = useViewerSettingsStore((s) => s.capable);

  return (
    <div className={styles.list}>
      {VIEWER_ROWS.map((row) => (
        <ViewerRow key={row.id} {...row} />
      ))}
      {!capable && <p className={styles.note}>Requires a newer daemon.</p>}
    </div>
  );
}
