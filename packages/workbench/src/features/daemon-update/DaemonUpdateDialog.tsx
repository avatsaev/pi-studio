/**
 * The daemon update dialog (`swe/features/self-update.md` § Workbench): opened by the pill (and,
 * once, by a result this client has not shown). Draws `daemonUpdateDialogView` and wires its
 * buttons; every decision is in the pure modules beside it. Always mounted (by the connection
 * bar), so the "show the result once" watcher keeps running while the dialog is closed.
 *
 * The dialog keeps its own state across the reconnect that ends an update: the status store is
 * cleared on disconnect, so `wasUpdating` holds the view on "Restarting" until the status (and
 * its `lastResult`) is back. Escape closes the dialog, except while it is restarting.
 */

import { useEffect, useState } from "react";
import { Button, DialogClose, Dialog, Spinner } from "@av-pi-studio/ui-library";
import type { DaemonUpdateStatus } from "@av-pi-studio/protocol";
import { getHost } from "../../host/install.js";
import { useClient, useConnectionStore } from "../../lib/connection/connection-store.js";
import { useUiStore } from "../../stores/ui-store.js";
import { useDaemonUpdateStore } from "../connection/daemon-update-store.js";
import { startDaemonUpdate } from "./daemon-update-actions.js";
import {
  daemonUpdateDialogView,
  type DaemonUpdateDialogView,
  type DaemonUpdateResult,
  type StageView,
} from "./daemon-update-dialog-view.js";
import { isUnseenResult, readShownMarker, writeShownMarker } from "./daemon-update-shown.js";
import { useUpdateImpact } from "./use-update-impact.js";
import styles from "./DaemonUpdateDialog.module.css";

const COPIED_MS = 1500;

/** The update is running on the daemon's side (the status says so). */
function isRunning(status: DaemonUpdateStatus | null): boolean {
  const kind = status?.state.kind;
  return kind === "installing" || kind === "updating_extensions" || kind === "restarting";
}

export function DaemonUpdateDialog() {
  const open = useUiStore((s) => s.daemonUpdateDialogOpen);
  const openDialog = useUiStore((s) => s.openDaemonUpdateDialog);
  const closeDialog = useUiStore((s) => s.closeDaemonUpdateDialog);
  const status = useDaemonUpdateStore((s) => s.status);
  const serverId = useConnectionStore((s) => s.serverInfo?.serverId);
  const client = useClient();
  const impact = useUpdateImpact(open);

  const [result, setResult] = useState<DaemonUpdateResult | null>(null);
  const [wasUpdating, setWasUpdating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A status that is gone (disconnect) keeps `wasUpdating`; any status that is not the running
  // update ends it (failure, result, idle).
  useEffect(() => {
    if (status === null) return;
    setWasUpdating(isRunning(status));
  }, [status]);

  // Show each result once per client: open the dialog on it and remember its `at`.
  const lastResult = status?.lastResult;
  useEffect(() => {
    if (!serverId || !isUnseenResult(lastResult, readShownMarker(getHost().storage, serverId))) {
      return;
    }
    writeShownMarker(getHost().storage, serverId, lastResult.at);
    setResult(lastResult);
    openDialog();
  }, [lastResult, serverId, openDialog]);

  const host = getHost();
  const view = daemonUpdateDialogView({
    status,
    impact,
    pageVersion: host.app.version,
    hostKind: host.app.platform === "desktop" || !host.reloadPage ? "desktop" : "browser",
    result,
    wasUpdating,
  });

  function close(): void {
    closeDialog();
    setResult(null);
    setError(null);
  }

  function start(check: boolean): void {
    if (!client || busy) return;
    setBusy(true);
    setError(null);
    void startDaemonUpdate(client, (next) => useDaemonUpdateStore.getState().apply(next), {
      check,
    }).then((message) => {
      setError(message);
      setBusy(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={view.title}
      width={440}
      onEscapeKeyDown={(event) => {
        if (view.kind === "restarting") event.preventDefault();
      }}
      footer={footerFor(view, { busy, start, reload: () => host.reloadPage?.() })}
    >
      <div className={styles.content} role="status" aria-live="polite">
        <Body view={view} />
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function cancel(label: string) {
  return (
    <DialogClose asChild>
      <Button size="sm" variant="secondary">
        {label}
      </Button>
    </DialogClose>
  );
}

function footerFor(
  view: DaemonUpdateDialogView,
  actions: { busy: boolean; start(check: boolean): void; reload(): void },
) {
  switch (view.kind) {
    case "confirm":
      return (
        <>
          {cancel("Cancel")}
          <Button size="sm" disabled={actions.busy} onClick={() => actions.start(false)}>
            Update and restart
          </Button>
        </>
      );
    case "failed":
      return (
        <>
          {cancel("Close")}
          <Button size="sm" disabled={actions.busy} onClick={() => actions.start(true)}>
            Retry
          </Button>
        </>
      );
    case "result":
      return (
        <>
          {cancel("Close")}
          {view.reload && (
            <Button size="sm" onClick={actions.reload}>
              Reload
            </Button>
          )}
        </>
      );
    case "restarting":
      return undefined;
    case "progress":
    case "cannot_update":
    case "none":
      return cancel("Close");
  }
}

function Body({ view }: { view: DaemonUpdateDialogView }) {
  switch (view.kind) {
    case "confirm":
      return (
        <>
          <p className={styles.versions} title={view.versions}>
            {view.versions}
          </p>
          <p className={styles.text}>{view.impact}</p>
        </>
      );
    case "progress":
      return <Stages stages={view.stages} />;
    case "restarting":
      return (
        <>
          <Stages stages={view.stages} />
          <p className={styles.note}>{view.note}</p>
        </>
      );
    case "result":
      return (
        <>
          <p className={`${styles.text} ${styles[view.tone]}`}>{view.text}</p>
          {view.message && <pre className={styles.output}>{view.message}</pre>}
          {view.reloadNote && <p className={styles.note}>{view.reloadNote}</p>}
        </>
      );
    case "cannot_update":
      return (
        <>
          {view.version && (
            <p className={styles.versions} title={view.version}>
              Daemon {view.version} is available.
            </p>
          )}
          <p className={styles.text}>{view.text}</p>
          <CommandBox command={view.command} />
        </>
      );
    case "failed":
      return (
        <>
          <p className={`${styles.text} ${styles.danger}`}>{view.text}</p>
          {view.message && <pre className={styles.output}>{view.message}</pre>}
          <p className={styles.note}>To update by hand, run on the daemon's host:</p>
          <CommandBox command={view.command} />
        </>
      );
    case "none":
      return <p className={styles.text}>{view.text}</p>;
  }
}

const STAGE_MARKS: Record<StageView["state"], string> = { done: "✓", active: "", pending: "·" };

function Stages({ stages }: { stages: StageView[] }) {
  return (
    <ol className={styles.stages}>
      {stages.map((stage) => (
        <li key={stage.label} className={`${styles.stage} ${styles[stage.state]}`}>
          <span className={styles.mark} aria-hidden>
            {stage.state === "active" ? (
              <Spinner size="xs" aria-label={stage.label} />
            ) : (
              STAGE_MARKS[stage.state]
            )}
          </span>
          <span className={styles.stageLabel}>{stage.label}</span>
        </li>
      ))}
    </ol>
  );
}

function CommandBox({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className={styles.command}>
      <pre className={styles.commandText}>{command}</pre>
      <Button
        size="xs"
        variant="secondary"
        onClick={() => {
          void getHost()
            .clipboard.writeText(command)
            .then(() => setCopied(true))
            .catch(() => setCopied(false));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
