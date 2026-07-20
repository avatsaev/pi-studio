/**
 * RemoveServerDialog — destructive confirm for deleting a saved server. Paseo pattern:
 * the danger is signaled by red ink on a quiet outline button in the row; the committed
 * red fill appears only here, on the confirm step.
 */

import { Button } from "@pi-studio-ui/components/primitives/Button.js";
import { Dialog } from "@pi-studio-ui/components/primitives/Dialog.js";
import {
  useSavedServersStore,
  type SavedServer,
} from "@pi-studio-ui/stores/saved-servers-store.js";
import styles from "./RemoveServerDialog.module.css";

export function RemoveServerDialog({
  server,
  onOpenChange,
}: {
  /** The entry pending removal; null closes the dialog. */
  server: SavedServer | null;
  onOpenChange: (open: boolean) => void;
}) {
  const removeServer = useSavedServersStore((s) => s.removeServer);

  return (
    <Dialog
      open={server !== null}
      onOpenChange={onOpenChange}
      title="Remove server"
      footer={
        <div className={styles.footerRow}>
          <Button
            variant="secondary"
            className={styles.footerButton}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className={styles.footerButton}
            onClick={() => {
              if (server) removeServer(server.id);
              onOpenChange(false);
            }}
          >
            Remove
          </Button>
        </div>
      }
    >
      <p className={styles.message}>Remove {server?.name}? This cannot be undone.</p>
    </Dialog>
  );
}
