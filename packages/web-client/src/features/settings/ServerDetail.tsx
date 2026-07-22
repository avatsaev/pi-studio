/**
 * ServerDetail — the detail pane for one saved server (Paseo host-overview pattern):
 * identity header with rename affordance, status pills, a "Connection" card (address,
 * password state, connect action), and a "Danger zone" card with the remove action.
 * Edit and remove both flow through modal dialogs.
 */

import { useState } from "react";
import { Pencil, Plug, Trash2 } from "lucide-react";
import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { Surface } from "@pi-studio-ui/components/primitives/Surface.js";
import {
  connectionTargetKey,
  isConnectedToDaemon,
  useConnectionStore,
} from "@pi-studio-ui/lib/connection/connection-store.js";
import { useConnectToServer } from "@pi-studio-ui/lib/connection/connect-to-server.js";
import { type SavedServer } from "@pi-studio-ui/stores/saved-servers-store.js";
import { useUiStore } from "@pi-studio-ui/stores/ui-store.js";
import { RemoveServerDialog } from "./RemoveServerDialog.js";
import { ServerFormDialog } from "./ServerFormDialog.js";
import { SettingsRow, SettingsSection, StatusPill } from "./settings-ui.js";
import styles from "./ServerDetail.module.css";

export function ServerDetail({ server }: { server: SavedServer }) {
  const status = useConnectionStore((s) => s.status);
  const connectedTarget = useConnectionStore((s) => s.connectedTarget);
  const connectionError = useConnectionStore((s) => s.error);
  const connectToServer = useConnectToServer();

  const [editOpen, setEditOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  // The pending target while "connecting" lives in the ui-store host field (seeded by
  // connectToServer / the toolbar); the settled connection reports connectedTarget.
  const pendingHost = useUiStore((s) => s.host);
  const targetKey = connectionTargetKey(server.url);
  const isLive = isConnectedToDaemon(status, connectedTarget, server.url);
  const isConnecting = status === "connecting" && targetKey === connectionTargetKey(pendingHost);

  return (
    <>
      <div className={styles.identity}>
        <span className={styles.name}>{server.name}</span>
        <button
          type="button"
          className={styles.editButton}
          title="Edit server"
          onClick={() => setEditOpen(true)}
        >
          <Pencil size={14} aria-hidden />
        </button>
      </div>

      <div className={styles.pills}>
        {isLive ? (
          <StatusPill tone="success" label="Connected" />
        ) : isConnecting ? (
          <StatusPill tone="warning" label="Connecting" />
        ) : (
          <StatusPill tone="muted" label="Not connected" />
        )}
      </div>

      {connectionError && (isLive || targetKey === connectionTargetKey(pendingHost)) && (
        <p className={styles.errorLine}>{connectionError}</p>
      )}

      <SettingsSection label="Connection">
        <Surface>
          <SettingsRow
            title="Address"
            control={<span className={styles.valueMono}>{server.url}</span>}
          />
          <SettingsRow
            title="Password"
            control={
              <span className={styles.valueMuted}>{server.password ? "Saved" : "Not saved"}</span>
            }
          />
          <SettingsRow
            title="Connect"
            hint="Connect to this daemon"
            control={
              isLive ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => useConnectionStore.getState().disconnect()}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  leftIcon={<Plug size={14} />}
                  loading={isConnecting}
                  onClick={() =>
                    void connectToServer({ url: server.url, password: server.password })
                  }
                >
                  {isConnecting ? "Connecting..." : "Connect"}
                </Button>
              )
            }
          />
        </Surface>
      </SettingsSection>

      <SettingsSection label="Danger zone" flush>
        <Surface>
          <SettingsRow
            title="Remove server"
            hint="Removes this server from this browser"
            control={
              <Button
                size="sm"
                variant="outline"
                leftIcon={<Trash2 size={14} />}
                className={styles.destructiveInk}
                onClick={() => setRemoveOpen(true)}
              >
                Remove
              </Button>
            }
          />
        </Surface>
      </SettingsSection>

      <ServerFormDialog open={editOpen} onOpenChange={setEditOpen} server={server} />
      <RemoveServerDialog server={removeOpen ? server : null} onOpenChange={setRemoveOpen} />
    </>
  );
}
