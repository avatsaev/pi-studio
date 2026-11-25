/**
 * PrivacyPanel — the Settings dialog's Privacy category (`swe/features/desktop-usage-data.md`
 * § 7). Present only when the host has `usageData` (the desktop app). Draws `privacyView` and the
 * fixed list of what is sent; a failed change shows the error and leaves the switch as it was.
 */

import { useState } from "react";
import { Switch } from "@av-pi-studio/ui-library";
import { getHost } from "../../host/install.js";
import { ExternalAnchor } from "../../host/external-link.js";
import {
  privacyView,
  USAGE_DATA_DESTINATION,
  USAGE_DATA_DOCS_URL,
  USAGE_DATA_NEVER,
  USAGE_DATA_SENT,
} from "./privacy-view.js";
import styles from "./PrivacyPanel.module.css";

export function PrivacyPanel() {
  const usageData = getHost().usageData;
  const [, refresh] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!usageData) return null;
  const view = privacyView(usageData.current());

  function change(enabled: boolean): void {
    if (!usageData || pending) return;
    setPending(true);
    setError(null);
    usageData.setEnabled(enabled).then(
      () => {
        setPending(false);
        refresh((n) => n + 1);
      },
      (e: unknown) => {
        setPending(false);
        setError(e instanceof Error ? e.message : String(e));
        refresh((n) => n + 1);
      },
    );
  }

  return (
    <div className={styles.list}>
      <div className={styles.row}>
        <div className={styles.rowMain}>
          <span className={styles.name}>Share anonymous usage data</span>
          <span className={styles.description}>
            Helps count active users, systems and versions. Nothing about your work is sent.
          </span>
        </div>
        <Switch
          checked={view.checked}
          disabled={pending}
          onCheckedChange={change}
          aria-label="Share anonymous usage data"
        />
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {view.blockedLine && (
        <p className={styles.note} role="status">
          {view.blockedLine}
        </p>
      )}
      <div className={styles.section}>
        <span className={styles.name}>What is sent</span>
        <ul className={styles.sent}>
          {USAGE_DATA_SENT.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <span className={styles.description}>{USAGE_DATA_NEVER}</span>
        <span className={styles.description}>
          {USAGE_DATA_DESTINATION}{" "}
          <ExternalAnchor href={USAGE_DATA_DOCS_URL} className={styles.link}>
            Read the Usage data page
          </ExternalAnchor>
        </span>
      </div>
      {view.idLine && (
        <p className={styles.id} title={view.idLine}>
          {view.idLine}
        </p>
      )}
    </div>
  );
}
