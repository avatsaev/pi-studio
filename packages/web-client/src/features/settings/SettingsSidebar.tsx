/**
 * SettingsSidebar — the list half of the settings list+detail shell (Paseo settings-shell
 * pattern): 320px, "Back" header row, "App" group (Providers), full-bleed separator,
 * "Servers" group with one row per saved server plus an always-present "Add server" row.
 * A server row's leading slot holds an 8px status dot when that entry is the live
 * connection; selection is fill + ink-darkening, no indicator bar.
 */

import { useNavigate } from "react-router";
import { ArrowLeft, Boxes, Plus } from "lucide-react";
import { clsx } from "clsx";
import {
  isConnectedToDaemon,
  useConnectionStore,
} from "@pi-studio-ui/lib/connection/connection-store.js";
import { useSavedServersStore } from "@pi-studio-ui/stores/saved-servers-store.js";
import styles from "./SettingsSidebar.module.css";

export type SettingsSelection = { kind: "providers" } | { kind: "server"; id: string };

export function SettingsSidebar({
  selection,
  onSelect,
  onAddServer,
}: {
  selection: SettingsSelection;
  onSelect: (selection: SettingsSelection) => void;
  onAddServer: () => void;
}) {
  const navigate = useNavigate();
  const servers = useSavedServersStore((s) => s.servers);
  const connectionStatus = useConnectionStore((s) => s.status);
  const connectedTarget = useConnectionStore((s) => s.connectedTarget);

  return (
    <aside className={styles.sidebar}>
      <button type="button" className={styles.backRow} onClick={() => navigate("/")}>
        <ArrowLeft size={14} aria-hidden />
        Back
      </button>

      <div className={styles.scroll}>
        <div className={styles.group}>
          <div className={styles.groupLabel}>App</div>
          <button
            type="button"
            className={clsx(styles.row, selection.kind === "providers" && styles.selected)}
            onClick={() => onSelect({ kind: "providers" })}
          >
            <Boxes size={16} aria-hidden className={styles.rowIcon} />
            <span className={styles.rowLabel}>Providers</span>
          </button>
        </div>

        <div className={styles.separator} />

        <div className={styles.group}>
          <div className={styles.groupLabel}>Servers</div>
          {servers.map((server) => {
            const isLive = isConnectedToDaemon(connectionStatus, connectedTarget, server.url);
            const selected = selection.kind === "server" && selection.id === server.id;
            return (
              <button
                key={server.id}
                type="button"
                className={clsx(styles.row, selected && styles.selected)}
                onClick={() => onSelect({ kind: "server", id: server.id })}
              >
                <span className={styles.dotSlot} aria-hidden>
                  {isLive && <span className={styles.liveDot} />}
                </span>
                <span className={styles.rowLabel}>{server.name}</span>
              </button>
            );
          })}
          <button type="button" className={styles.row} onClick={onAddServer}>
            <Plus size={16} aria-hidden className={styles.rowIcon} />
            <span className={styles.rowLabel}>Add server</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
