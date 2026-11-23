/**
 * The add/edit form of the Daemons screen. What it shows, checks and sends is `daemon-form.ts`;
 * what Save does against the host is `daemon-form-actions.ts`. This only holds the typed values.
 *
 * Values live in this component's state only: it unmounts when the form closes, which drops what
 * was typed. A stored password or pairing link is never put in a field; the password field shows a
 * "saved" marker instead, and the link field is a replacement that starts empty.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button, Select, TextInput } from "@av-pi-studio/ui-library";
import { type HostDaemons, type SshHostSuggestion } from "../../host/types.js";
import { submitAdd, submitEdit } from "./daemon-form-actions.js";
import {
  DEFAULT_DAEMON_PORT,
  KIND_OPTIONS,
  chooseSshHost,
  formView,
  initialAddFields,
  initialEditFields,
  linkReplaced,
  sshPlaceholders,
  withoutError,
  type FormErrors,
  type FormField,
  type FormFields,
  type FormKind,
  type FormMode,
  type PasswordFieldView,
} from "./daemon-form.js";
import { useDaemonsStore } from "./daemons-store.js";
import styles from "./DaemonsScreen.module.css";

const ID = "daemon-form";

export function DaemonForm({
  daemons,
  mode,
  onClose,
  onSaved,
}: {
  daemons: HostDaemons;
  mode: FormMode;
  onClose: () => void;
  /** The change was saved. `reconnect`: the current entry now dials something else. */
  onSaved: (reconnect: boolean) => void;
}) {
  const [fields, setFields] = useState<FormFields>(() =>
    mode.type === "edit" ? initialEditFields(mode.entry) : initialAddFields(),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<SshHostSuggestion[]>([]);
  const view = formView(mode, fields);
  const placeholders = sshPlaceholders(fields.host, suggestions);

  // The config's hosts, once an SSH form is open. A config that does not parse gives no list.
  useEffect(() => {
    if (!view.showSsh) return;
    let current = true;
    daemons.sshHosts().then(
      (hosts) => {
        if (current) setSuggestions(hosts);
      },
      () => {
        if (current) setSuggestions([]);
      },
    );
    return () => {
      current = false;
    };
  }, [daemons, view.showSsh]);

  /** Change a value; the message of that field (and the form's) no longer applies. */
  function change(field: FormField, patch: Partial<FormFields>): void {
    setFields((current) => ({ ...current, ...patch }));
    setErrors((current) => withoutError(current, field));
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    const outcome =
      mode.type === "edit"
        ? await submitEdit(daemons, mode.entry, fields)
        : await submitAdd(daemons, fields);
    if (outcome.status === "saved") {
      if (mode.type === "edit" && linkReplaced(mode.entry, fields)) {
        useDaemonsStore.getState().clearLinkInvalid(mode.entry.id);
      }
      onSaved(outcome.reconnect);
      return;
    }
    setErrors(outcome.errors);
    setSaving(false);
  }

  return (
    <form
      className={styles.form}
      aria-labelledby={`${ID}-title`}
      onSubmit={(event) => void handleSubmit(event)}
    >
      <h3 className={styles.heading} id={`${ID}-title`} title={view.title}>
        {view.title}
      </h3>
      {errors.form && (
        <div className={styles.fieldError} role="alert">
          {errors.form}
        </div>
      )}
      {view.showKind && (
        <FormRow id={`${ID}-kind`} label="Kind">
          <Select
            id={`${ID}-kind`}
            value={fields.kind}
            options={KIND_OPTIONS}
            onChange={(event) => {
              setFields({ ...fields, kind: event.target.value as FormKind });
              setErrors({});
            }}
          />
        </FormRow>
      )}
      <FormRow id={`${ID}-name`} label="Name" error={errors.name}>
        <TextInput
          id={`${ID}-name`}
          value={fields.name}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={errors.name !== undefined || undefined}
          aria-describedby={errors.name === undefined ? undefined : `${ID}-name-error`}
          onChange={(event) => change("name", { name: event.target.value })}
        />
      </FormRow>
      {view.showSsh && (
        <>
          {suggestions.length > 0 && (
            <FormRow id={`${ID}-config-host`} label="Hosts in ~/.ssh/config">
              <Select
                id={`${ID}-config-host`}
                value=""
                options={[
                  { value: "", label: "Choose a host…" },
                  ...suggestions.map((s) => ({ value: s.alias, label: s.alias })),
                ]}
                onChange={(event) => {
                  const alias = event.target.value;
                  if (alias === "") return;
                  setFields((current) => chooseSshHost(current, alias));
                  setErrors({});
                }}
              />
            </FormRow>
          )}
          <FormRow id={`${ID}-host`} label="Host" error={errors.host}>
            <TextInput
              id={`${ID}-host`}
              value={fields.host}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={errors.host !== undefined || undefined}
              aria-describedby={errors.host === undefined ? undefined : `${ID}-host-error`}
              onChange={(event) => change("host", { host: event.target.value })}
            />
          </FormRow>
          <TextRow
            id="user"
            label="User"
            field="user"
            fields={fields}
            errors={errors}
            placeholder={placeholders.user}
            change={change}
          />
          <TextRow
            id="port"
            label="Port"
            field="port"
            fields={fields}
            errors={errors}
            placeholder={placeholders.port}
            change={change}
          />
          <TextRow
            id="key"
            label="Key file"
            field="identityFile"
            fields={fields}
            errors={errors}
            placeholder={placeholders.identityFile}
            change={change}
          />
          <TextRow
            id="jump"
            label="Jump host"
            field="jump"
            fields={fields}
            errors={errors}
            placeholder={placeholders.jump}
            change={change}
          />
          <TextRow
            id="daemon-port"
            label="Daemon port"
            field="daemonPort"
            fields={fields}
            errors={errors}
            placeholder={String(DEFAULT_DAEMON_PORT)}
            change={change}
          />
          <SecretRow
            id="ssh-password"
            label="SSH password"
            view={view.sshPassword}
            value={fields.sshPassword}
            error={errors.sshPassword}
            onType={(value) => change("sshPassword", { sshPassword: value })}
            onClear={(clear) => change("sshPassword", { clearSshPassword: clear, sshPassword: "" })}
          />
          <SecretRow
            id="passphrase"
            label="Key passphrase"
            view={view.passphrase}
            value={fields.passphrase}
            error={errors.passphrase}
            onType={(value) => change("passphrase", { passphrase: value })}
            onClear={(clear) => change("passphrase", { clearPassphrase: clear, passphrase: "" })}
          />
        </>
      )}
      {view.showAddress && (
        <FormRow id={`${ID}-address`} label="Address" error={errors.address}>
          <TextInput
            id={`${ID}-address`}
            value={fields.address}
            placeholder="ws://127.0.0.1:6767"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={errors.address !== undefined || undefined}
            aria-describedby={errors.address === undefined ? undefined : `${ID}-address-error`}
            onChange={(event) => change("address", { address: event.target.value })}
          />
        </FormRow>
      )}
      {view.showPassword && (
        <SecretRow
          id="password"
          label={view.showSsh ? "Daemon password" : "Password"}
          view={view.password}
          value={fields.password}
          error={errors.password}
          onType={(value) => change("password", { password: value })}
          onClear={(clear) => change("password", { clearPassword: clear, password: "" })}
        />
      )}
      {view.showLink && (
        <FormRow id={`${ID}-link`} label={view.linkLabel} error={errors.link}>
          <TextInput
            id={`${ID}-link`}
            type="password"
            value={fields.pairingLink}
            placeholder={view.linkPlaceholder}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={errors.link !== undefined || undefined}
            aria-describedby={errors.link === undefined ? undefined : `${ID}-link-error`}
            onChange={(event) => change("link", { pairingLink: event.target.value })}
          />
        </FormRow>
      )}
      <div className={styles.formActions}>
        <Button size="sm" variant="ghost" type="button" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={saving}>
          {view.submitLabel}
        </Button>
      </div>
    </form>
  );
}

type TextKey = "user" | "port" | "identityFile" | "jump" | "daemonPort";

function TextRow({
  id,
  label,
  field,
  fields,
  errors,
  placeholder,
  change,
}: {
  id: string;
  label: string;
  field: TextKey;
  fields: FormFields;
  errors: FormErrors;
  placeholder: string;
  change: (field: FormField, patch: Partial<FormFields>) => void;
}) {
  const rowId = `${ID}-${id}`;
  return (
    <FormRow id={rowId} label={label} error={errors[field]}>
      <TextInput
        id={rowId}
        value={fields[field]}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={errors[field] !== undefined || undefined}
        aria-describedby={errors[field] === undefined ? undefined : `${rowId}-error`}
        onChange={(event) => change(field, { [field]: event.target.value })}
      />
    </FormRow>
  );
}

/** A secret: never shown, a "saved" marker, Clear (and Keep while a clear is pending). */
function SecretRow({
  id,
  label,
  view,
  value,
  error,
  onType,
  onClear,
}: {
  id: string;
  label: string;
  view: PasswordFieldView;
  value: string;
  error?: string;
  onType: (value: string) => void;
  /** `true`: mark for removal; `false`: keep. */
  onClear: (clear: boolean) => void;
}) {
  const rowId = `${ID}-${id}`;
  return (
    <FormRow id={rowId} label={label} marker={view.marker} error={error}>
      <div className={styles.pathRow}>
        <TextInput
          id={rowId}
          type="password"
          value={value}
          placeholder={view.placeholder}
          autoComplete="new-password"
          onChange={(event) => onType(event.target.value)}
        />
        {view.canClear && (
          <Button size="sm" variant="secondary" type="button" onClick={() => onClear(true)}>
            Clear
          </Button>
        )}
        {view.canUndoClear && (
          <Button size="sm" variant="secondary" type="button" onClick={() => onClear(false)}>
            Keep
          </Button>
        )}
      </div>
    </FormRow>
  );
}

function FormRow({
  id,
  label,
  marker,
  error,
  children,
}: {
  id: string;
  label: string;
  /** The "saved" marker of a password that exists. */
  marker?: string | null;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.settingField}>
      <div className={styles.labelRow}>
        <label className={styles.settingLabel} htmlFor={id}>
          {label}
        </label>
        {marker && <span className={styles.savedMarker}>{marker}</span>}
      </div>
      {children}
      {error && (
        <div className={styles.fieldError} id={`${id}-error`} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
