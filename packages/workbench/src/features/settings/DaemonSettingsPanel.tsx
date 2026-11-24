/**
 * DaemonSettingsPanel — the Settings dialog's Daemon category (`swe/features/self-update.md`
 * § Workbench, sprint-137/task-003). Present only when the daemon has the `daemonUpdate`
 * capability (`settings-categories.ts`). Draws `daemonSettingsView` from the connection's status
 * store (the same status as the connection bar's pill) and wires "Check now", the automatic-check
 * switch and the update action, which opens the update dialog; the decisions are in
 * `daemon-settings-view.ts` and `daemon-settings-actions.ts`.
 */

import { useEffect, useState } from "react";
import { Button, EmptyState, Spinner, Switch } from "@av-pi-studio/ui-library";
import { useClient } from "../../lib/connection/connection-store.js";
import { useUiStore } from "../../stores/ui-store.js";
import { useDaemonUpdateStore } from "../connection/daemon-update-store.js";
import { changeAutoCheck, checkDaemonNow } from "./daemon-settings-actions.js";
import { autoCheckHelpText, daemonSettingsView } from "./daemon-settings-view.js";
import styles from "./DaemonSettingsPanel.module.css";

/** How often the "5 minutes ago" wording is recomputed. */
const CLOCK_MS = 30_000;

export function DaemonSettingsPanel() {
  const status = useDaemonUpdateStore((s) => s.status);
  const client = useClient();
  const openDialog = useUiStore((s) => s.openDaemonUpdateDialog);

  const [pendingAutoCheck, setPendingAutoCheck] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  if (!status) {
    return (
      <EmptyState>
        <Spinner size="sm" /> Loading…
      </EmptyState>
    );
  }

  const view = daemonSettingsView({ status, pendingAutoCheck, now });

  function checkNow(): void {
    if (!client || checking) return;
    setChecking(true);
    setError(null);
    void checkDaemonNow(client, (next) => useDaemonUpdateStore.getState().apply(next)).then(
      (message) => {
        setError(message);
        setChecking(false);
      },
    );
  }

  function setAutoCheck(enabled: boolean): void {
    if (!client || pendingAutoCheck !== null) return;
    setError(null);
    void changeAutoCheck(client, enabled, {
      applyStatus: (next) => useDaemonUpdateStore.getState().apply(next),
      setPending: setPendingAutoCheck,
    }).then(setError);
  }

  return (
    <div className={styles.list}>
      <div className={styles.row}>
        <span className={styles.name}>Version</span>
        <span className={styles.value} title={view.version}>
          {view.version}
        </span>
      </div>
      <div className={styles.row}>
        <span className={styles.name}>Installed as</span>
        <span className={styles.value} title={view.installKind}>
          {view.installKind}
        </span>
      </div>
      <div className={styles.row}>
        <div className={styles.rowMain}>
          <span className={styles.name}>Last checked</span>
          <span className={styles.value} title={view.lastChecked}>
            {view.lastChecked}
          </span>
          {view.checkError && (
            <span className={styles.error} role="status">
              {view.checkError}
            </span>
          )}
          {view.skipped && (
            <span className={styles.description} role="status">
              {view.skipped}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!client || checking || view.checkDisabled}
          onClick={checkNow}
        >
          {checking ? "Checking…" : "Check now"}
        </Button>
      </div>
      <div className={styles.row}>
        <div className={styles.rowMain}>
          <span className={styles.name}>Check automatically</span>
          <span className={styles.description}>{autoCheckHelpText(status.installKind)}</span>
        </div>
        <Switch
          checked={view.autoCheck}
          disabled={!client || pendingAutoCheck !== null}
          onCheckedChange={setAutoCheck}
          aria-label="Check for daemon updates automatically"
        />
      </div>
      <div className={styles.row}>
        <span className={`${styles.text} ${styles[view.update.tone]}`}>{view.update.text}</span>
        {view.update.action && (
          <Button size="sm" onClick={openDialog}>
            {view.update.action}
          </Button>
        )}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
