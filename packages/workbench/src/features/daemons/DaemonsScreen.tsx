/**
 * DaemonsScreen — the modal that lists the registry's entries, drives the local daemon, holds the
 * two daemon settings and removes entries (`swe/features/desktop-daemon-registry.md` § Public
 * contract 4). Mounted once in `WorkspaceShell`; renders nothing when the host has no registry
 * (the browser). Open/closed state and the error shown in the banner live in `useDaemonsStore`;
 * what each row offers and what the banner says is `daemons-screen-view.ts`; what a button does
 * against the host is `daemons-screen-actions.ts`.
 *
 * Add and Edit swap the list for `DaemonForm` (`daemon-form.ts` decides what it checks and sends).
 * After a saved change that alters what the current entry dials, the screen offers "Reconnect
 * now"; nothing reconnects by itself.
 *
 * Focus is the `Dialog` primitive's: it moves in on open, Escape and the close button dismiss, and
 * focus returns to what had it.
 */

import { useEffect, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button, Dialog, Switch, TextInput } from "@av-pi-studio/ui-library";
import { getHost } from "../../host/install.js";
import { useConnectionStore } from "../../lib/connection/connection-store.js";
import { type DaemonSettings, type HostDaemons } from "../../host/types.js";
import { type FormMode } from "./daemon-form.js";
import { type LocalAction } from "./daemon-presentation.js";
import {
  openEntry,
  removeEntry,
  runLocalAction,
  runLocalActionAsking,
  stopNeedsConfirm,
  saveAutoStart,
  saveCliPath,
  type ActionOutcome,
} from "./daemons-screen-actions.js";
import {
  buildDaemonsScreenView,
  cliPathChanged,
  cliPathToField,
  type BannerView,
  LINK_INVALID_LABEL,
  type EntryRowView,
  type LocalRowView,
} from "./daemons-screen-view.js";
import { DaemonForm } from "./DaemonForm.js";
import { useDaemonsStore } from "./daemons-store.js";
import { useDaemons } from "./use-daemons.js";
import styles from "./DaemonsScreen.module.css";

const SETTINGS_FORM_ID = "daemons-settings-form";
const AUTO_START_ID = "daemons-auto-start";
const CLI_PATH_ID = "daemons-cli-path";

export function DaemonsScreen() {
  const daemons = getHost().daemons;
  return daemons ? <DaemonsDialog daemons={daemons} /> : null;
}

function DaemonsDialog({ daemons }: { daemons: HostDaemons }) {
  const open = useDaemonsStore((s) => s.open);
  const error = useDaemonsStore((s) => s.error);
  const closeScreen = useDaemonsStore((s) => s.closeScreen);
  const setError = useDaemonsStore((s) => s.setError);
  const invalidLinks = useDaemonsStore((s) => s.invalidLinks);
  const status = useConnectionStore((s) => s.status);
  const snapshot = useDaemons();
  const [form, setForm] = useState<FormMode | null>(null);
  const [reconnectOffered, setReconnectOffered] = useState(false);

  // The state shown is current when the screen opens; a probe's outcome arrives as a state change.
  useEffect(() => {
    if (open) void runLocalAction(daemons, "refresh");
  }, [open, daemons]);

  if (!snapshot) return null;
  const view = buildDaemonsScreenView(snapshot, error, invalidLinks);

  /** Run a host action; its failure becomes the banner, a stale banner is cleared first. */
  async function run(action: () => Promise<ActionOutcome>): Promise<void> {
    setError(null);
    const failure = await action();
    if (failure !== null) setError(failure);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        closeScreen();
        setError(null);
        setForm(null);
        setReconnectOffered(false);
      }}
      title="Daemons"
      width={640}
    >
      <div className={styles.content}>
        {view.banner && <Banner banner={view.banner} />}
        {form ? (
          <DaemonForm
            daemons={daemons}
            mode={form}
            onClose={() => setForm(null)}
            onSaved={(reconnect) => {
              setForm(null);
              setReconnectOffered(reconnect);
            }}
          />
        ) : (
          <>
            {reconnectOffered && (
              <div className={styles.bannerInfo} role="status">
                <div className={styles.reconnect}>
                  <span className={styles.bannerMessage}>Saved. Reconnect to use the change.</span>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => {
                      setReconnectOffered(false);
                      void useDaemonsStore.getState().connectCurrent();
                    }}
                  >
                    Reconnect now
                  </Button>
                </div>
              </div>
            )}
            <div className={styles.listHeader}>
              <h3 className={styles.heading}>Saved daemons</h3>
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<Plus size={14} />}
                onClick={() => {
                  setReconnectOffered(false);
                  setForm({ type: "add" });
                }}
              >
                Add daemon
              </Button>
            </div>
            <ul className={styles.list}>
              {view.rows.map((row) => (
                <EntryRow
                  key={row.id}
                  row={row}
                  onOpen={() => void run(() => openEntry(daemons, row.id))}
                  onEdit={() => {
                    const entry = snapshot.entries.find((e) => e.id === row.id);
                    if (!entry) return;
                    setReconnectOffered(false);
                    setForm({ type: "edit", entry });
                  }}
                  onRemove={() => void run(() => removeEntry(daemons, getHost().dialogs, row))}
                  onLocalAction={(call) =>
                    void run(() =>
                      runLocalActionAsking(
                        daemons,
                        getHost().dialogs,
                        call,
                        stopNeedsConfirm(call, row.current, status),
                      ),
                    )
                  }
                />
              ))}
            </ul>
            <SettingsSection daemons={daemons} settings={snapshot.settings} />
          </>
        )}
      </div>
    </Dialog>
  );
}

function Banner({ banner }: { banner: BannerView }) {
  const isError = banner.tone === "error";
  return (
    <div
      className={isError ? styles.bannerError : styles.bannerInfo}
      role={isError ? "alert" : "status"}
    >
      <span className={styles.bannerMessage}>{banner.message}</span>
      {banner.detail && <span className={styles.bannerDetail}>{banner.detail}</span>}
      {banner.command && <code className={styles.command}>{banner.command}</code>}
    </div>
  );
}

function EntryRow({
  row,
  onOpen,
  onEdit,
  onRemove,
  onLocalAction,
}: {
  row: EntryRowView;
  onOpen: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onLocalAction: (call: LocalAction["call"]) => void;
}) {
  return (
    <li className={styles.row} data-current={row.current || undefined}>
      <div className={styles.rowMain}>
        <div className={styles.rowTitle}>
          <span className={styles.name} title={row.name}>
            {row.name}
          </span>
          <span className={styles.kind}>{row.kindLabel}</span>
          {row.current && <span className={styles.currentMark}>Current</span>}
        </div>
        {row.linkInvalid && (
          <div className={styles.linkInvalid} role="status">
            {LINK_INVALID_LABEL}
          </div>
        )}
        {row.address && (
          <div className={styles.address} title={row.address}>
            {row.address}
          </div>
        )}
        {row.local && <LocalState local={row.local} />}
      </div>
      <div className={styles.rowActions}>
        {row.local?.actions.map((action) => (
          <Button
            key={action.kind}
            size="xs"
            variant="secondary"
            onClick={() => onLocalAction(action.call)}
          >
            {action.label}
          </Button>
        ))}
        {row.actions.includes("open") && (
          <Button size="xs" variant="secondary" onClick={onOpen}>
            Open
          </Button>
        )}
        {row.actions.includes("replaceLink") && (
          <Button size="xs" variant="secondary" onClick={onEdit}>
            Replace link
          </Button>
        )}
        {row.actions.includes("edit") && (
          <Button size="xs" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
        )}
        {row.actions.includes("remove") && (
          <Button size="xs" variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
    </li>
  );
}

function LocalState({ local }: { local: LocalRowView }) {
  return (
    <div className={styles.localState}>
      <div className={styles.stateLabel} data-tone={local.tone} title={local.label}>
        {local.label}
      </div>
      {local.notice && (
        <div className={styles.notice}>
          <span>{local.notice.text}</span>
          {local.notice.command && <code className={styles.command}>{local.notice.command}</code>}
        </div>
      )}
    </div>
  );
}

function SettingsSection({
  daemons,
  settings,
}: {
  daemons: HostDaemons;
  settings: DaemonSettings;
}) {
  const [cliPath, setCliPath] = useState(() => cliPathToField(settings));
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const changed = cliPathChanged(cliPath, settings);

  async function save(outcome: Promise<string | null>): Promise<void> {
    setSaving(true);
    setFailure(await outcome);
    setSaving(false);
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!changed || saving) return;
    void save(
      saveCliPath(daemons, cliPath).then((reason) => {
        // A refused value keeps the previous one.
        if (reason !== null) setCliPath(cliPathToField(settings));
        return reason;
      }),
    );
  }

  return (
    <section className={styles.settings} aria-labelledby="daemons-settings-heading">
      <h3 className={styles.heading} id="daemons-settings-heading">
        Local daemon
      </h3>
      <div className={styles.settingRow}>
        <label className={styles.settingLabel} htmlFor={AUTO_START_ID}>
          Start the local daemon when this machine is opened
        </label>
        <Switch
          id={AUTO_START_ID}
          checked={settings.autoStartLocalDaemon}
          disabled={saving}
          onCheckedChange={(enabled) => void save(saveAutoStart(daemons, enabled))}
        />
      </div>
      <form id={SETTINGS_FORM_ID} className={styles.settingField} onSubmit={handleSubmit}>
        <label className={styles.settingLabel} htmlFor={CLI_PATH_ID}>
          Path of the pi-studio CLI
        </label>
        <div className={styles.pathRow}>
          <TextInput
            id={CLI_PATH_ID}
            value={cliPath}
            placeholder="Empty: find it"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setCliPath(event.target.value)}
          />
          <Button size="sm" type="submit" disabled={!changed || saving}>
            Save
          </Button>
        </div>
      </form>
      {failure && (
        <div className={styles.settingError} role="alert">
          {failure}
        </div>
      )}
    </section>
  );
}
