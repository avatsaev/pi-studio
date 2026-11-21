/**
 * The add/edit form of the Daemons screen. What it shows, checks and sends is `daemon-form.ts`;
 * what Save does against the host is `daemon-form-actions.ts`. This only holds the typed values.
 *
 * Values live in this component's state only: it unmounts when the form closes, which drops what
 * was typed. A stored password or pairing link is never put in a field; the password field shows a
 * "saved" marker instead, and the link field is a replacement that starts empty.
 */

import { useState, type FormEvent, type ReactNode } from "react";
import { Button, Select, TextInput } from "@av-pi-studio/ui-library";
import { type HostDaemons } from "../../host/types.js";
import { submitAdd, submitEdit } from "./daemon-form-actions.js";
import {
  KIND_OPTIONS,
  formView,
  initialAddFields,
  initialEditFields,
  linkReplaced,
  withoutError,
  type FormErrors,
  type FormField,
  type FormFields,
  type FormKind,
  type FormMode,
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
  const view = formView(mode, fields);

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
        <FormRow
          id={`${ID}-password`}
          label="Password"
          marker={view.password.marker}
          error={errors.password}
        >
          <div className={styles.pathRow}>
            <TextInput
              id={`${ID}-password`}
              type="password"
              value={fields.password}
              placeholder={view.password.placeholder}
              autoComplete="new-password"
              onChange={(event) => change("password", { password: event.target.value })}
            />
            {view.password.canClear && (
              <Button
                size="sm"
                variant="secondary"
                type="button"
                onClick={() => change("password", { clearPassword: true, password: "" })}
              >
                Clear
              </Button>
            )}
            {view.password.canUndoClear && (
              <Button
                size="sm"
                variant="secondary"
                type="button"
                onClick={() => change("password", { clearPassword: false })}
              >
                Keep
              </Button>
            )}
          </div>
        </FormRow>
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
