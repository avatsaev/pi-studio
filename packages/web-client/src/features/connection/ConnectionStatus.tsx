/**
 * Connection status dot + label (POC `#dot`/`#status`, POC_TO_APP_PLAN_UI.md §4.1).
 */

import { clsx } from "clsx";
import { useConnectionStore } from "@pi-studio-ui/lib/connection/connection-store.js";
import styles from "./ConnectionStatus.module.css";

const LABEL: Record<string, string> = {
  idle: "disconnected",
  connecting: "connecting…",
  open: "connected",
  closing: "disconnecting…",
  closed: "disconnected",
};

export function ConnectionStatus() {
  const status = useConnectionStore((s) => s.status);
  const error = useConnectionStore((s) => s.error);

  return (
    <span className={styles.wrap} title={error ?? undefined}>
      <span className={clsx(styles.dot, styles[status])} />
      {LABEL[status] ?? status}
    </span>
  );
}
